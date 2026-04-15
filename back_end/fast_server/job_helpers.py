"""
job_helpers.py
- 학습 실행/일시정지/재개/리셋을 "끊기지 않게" 만들기 위한 헬퍼

전제:
- db.py 에 jobs_col, progress_col (pymongo Collection) 이 존재
- db.py 에 to_object_id(str)->ObjectId 가 존재
- jobs.py 에서 아래 함수/상수들을 import 해서 사용
"""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import threading
import time
from dataclasses import dataclass
import uuid
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from bson import ObjectId
import yaml

from db import jobs_col, progress_col, to_object_id

# -----------------------------
# 런타임 상태(메모리)
# -----------------------------
JOB_ACTIVE: Dict[str, bool] = {}
_JOB_PROC: Dict[str, "JobProc"] = {}
_LOCK = threading.RLock()


@dataclass
class JobProc:
    popen: subprocess.Popen
    mode: str  # "run" | "resume"
    stop_mode: Optional[str] = None  # None | "pause" | "stop" | "reset"
    stop_sent: bool = False
    pause_requested_epoch: Optional[int] = None
    run_dir: Optional[Path] = None
    started_at: float = 0.0


# -----------------------------
# 공통 유틸
# -----------------------------
def _now() -> float:
    return time.time()


def _oid(job_id: str) -> ObjectId:
    return to_object_id(job_id)


def _runs_root() -> Path:
    # fast_server 기준으로 runs 폴더를 쓰는 게 관리가 편함
    base = Path(os.getenv("RUNS_DIR") or Path(__file__).resolve().parent / "runs")
    base.mkdir(parents=True, exist_ok=True)
    return base


def _job_run_dir(job_id: str) -> Path:
    d = _runs_root() / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _current_epoch(job_id: str) -> int:
    doc = progress_col.find_one({"_id": _oid(job_id)}, {"epoch": 1, "last_epoch": 1})
    if not doc:
        return 0
    try:
        return max(int(doc.get("last_epoch") or 0), int(doc.get("epoch") or 0))
    except Exception:
        return 0


def _send_sigint(popen: subprocess.Popen) -> None:
    try:
        popen.send_signal(signal.SIGINT)
        return
    except Exception:
        pass
    try:
        popen.terminate()
    except Exception:
        pass

# -----------------------------
# data.yaml 보정
# -----------------------------
def _sanitize_data_yaml(data_path: str) -> str:
    """
    data.yaml의 train/val 경로가 잘못되었을 때(ex: runs/.../images/val) 실제 데이터셋 폴더 기준으로 교체.
    """
    p = Path(data_path)
    if not p.exists():
        return data_path

    try:
        cfg = yaml.safe_load(p.read_text()) or {}
    except Exception:
        return data_path

    base = p.parent
    images_dir = base / "images"
    train_dir = images_dir / "train"
    val_dir = images_dir / "val"
    test_dir = images_dir / "test"

    changed = False

    def _set_if_invalid(key: str, candidate: Path) -> None:
        nonlocal changed
        cur = cfg.get(key)
        try:
            cur_path = Path(cur) if cur else None
        except Exception:
            cur_path = None
        need_fix = (not cur) or (cur_path and not cur_path.exists()) or (cur and "runs/" in str(cur))
        if need_fix and candidate.exists():
            cfg[key] = str(candidate.resolve())
            changed = True

    _set_if_invalid("train", train_dir)
    _set_if_invalid("val", val_dir)
    _set_if_invalid("test", test_dir)

    # path가 runs/... 등 잘못된 값이면 data.yaml 위치로 교체
    cur_path_val = cfg.get("path")
    if cur_path_val and "runs/" in str(cur_path_val):
        cfg["path"] = str(base.resolve())
        changed = True

    if changed:
        try:
            p.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True))
        except Exception:
            pass

    return str(p)


def _progress_doc(job_id: str) -> Dict[str, Any]:
    # progress_col 한 문서에 logs/metrics 를 쌓는 구조
    return {
        "_id": _oid(job_id),
        "job_id": job_id,
        "status": "idle",
        "progress": 0.0,
        "epoch": 0,
        "total_epochs": 0,
        "updated_at": _now(),
        "logs": [],
        "metrics": [],  # [{"epoch":1, "train_loss":..., "val_loss":..., "train_acc":..., "val_acc":...}, ...]
        "last_epoch": 0,
        "train_loss": [],
        "val_loss": [],
        "train_accuracy": [],
        "val_accuracy": [],
        "history": {
            "train_loss": [],
            "val_loss": [],
            "train_accuracy": [],
            "val_accuracy": [],
        },
    }


def update_job(job_id: str, **fields: Any) -> None:
    fields["updated_at"] = _now()
    jobs_col.update_one({"_id": _oid(job_id)}, {"$set": fields})


def mark_job_running(job_id: str) -> None:
    update_job(job_id, status="running", error_message=None, started_at=_now())


def mark_failed(job_id: str, msg: str) -> None:
    update_job(job_id, status="failed", error_message=str(msg))


def _append_log(job_id: str, line: str, keep_last: int = 2000) -> None:
    # 로그 폭주 방지: 마지막 keep_last 줄만 유지
    doc = progress_col.find_one({"_id": _oid(job_id)}, {"run_id": 1})
    run_id = doc.get("run_id") if isinstance(doc, dict) else None
    progress_col.update_one(
        {"_id": _oid(job_id)},
        {
            "$push": {
                "logs": {
                    "$each": [{"t": _now(), "line": line, "run_id": run_id}],
                    "$slice": -keep_last,
                }
            },
            "$set": {"updated_at": _now(), "job_id": job_id},
        },
        upsert=True,
    )


def _upsert_metric(job_id: str, row: Dict[str, Any]) -> None:
    """
    epoch 기준으로 metrics 배열에 upsert.
    MongoDB 배열 upsert는 까다로워서:
    - metrics 전체를 읽고(작음), epoch 있으면 교체, 없으면 append 후 저장
    """
    doc = progress_col.find_one({"_id": _oid(job_id)}) or _progress_doc(job_id)
    run_id = doc.get("run_id") or "legacy"
    metrics = doc.get("metrics") or []
    epoch = int(row.get("epoch") or 0)
    total_epochs = row.get("total_epochs")
    if epoch <= 0:
        return
    row["run_id"] = run_id

    replaced = False
    for i, m in enumerate(metrics):
        if int(m.get("epoch") or 0) == epoch and (m.get("run_id") or "legacy") == run_id:
            metrics[i] = row
            replaced = True
            break
    if not replaced:
        metrics.append(row)
        metrics.sort(key=lambda x: int(x.get("epoch") or 0))

    metrics_current = [m for m in metrics if (m.get("run_id") or "legacy") == run_id]
    last_epoch = max([int(m.get("epoch") or 0) for m in metrics_current], default=0)

    # history 배열은 프론트 차트가 바로 쓸 수 있게 별도 필드로 함께 저장
    hist_train_loss = [m.get("train_loss") for m in metrics_current if m.get("train_loss") is not None]
    hist_val_loss = [m.get("val_loss") for m in metrics_current if m.get("val_loss") is not None]
    hist_train_acc = [m.get("train_acc") for m in metrics_current if m.get("train_acc") is not None]
    hist_val_acc = [m.get("val_acc") for m in metrics_current if m.get("val_acc") is not None]

    progress_pct = None
    try:
        if total_epochs and int(total_epochs) > 0:
            progress_pct = min(100.0, float(epoch) / float(total_epochs) * 100.0)
    except Exception:
        progress_pct = None

    update_fields: Dict[str, Any] = {
        "metrics": metrics,
        "last_epoch": last_epoch,
        "epoch": epoch,
        "updated_at": _now(),
        "job_id": job_id,
        "train_loss": hist_train_loss,
        "val_loss": hist_val_loss,
        "train_accuracy": hist_train_acc,
        "val_accuracy": hist_val_acc,
        "history": {
            "train_loss": hist_train_loss,
            "val_loss": hist_val_loss,
            "train_accuracy": hist_train_acc,
            "val_accuracy": hist_val_acc,
        },
    }
    if total_epochs:
        update_fields["total_epochs"] = int(total_epochs)
    if progress_pct is not None:
        update_fields["progress"] = progress_pct

    progress_col.update_one(
        {"_id": _oid(job_id)},
        {"$set": update_fields},
        upsert=True,
    )


def get_running_info(job_id: str) -> Dict[str, Any]:
    with _LOCK:
        p = _JOB_PROC.get(job_id)
        if not p:
            return {"active": False}
        return {
            "active": True,
            "pid": p.popen.pid,
            "stop_mode": p.stop_mode,
            "run_dir": str(p.run_dir) if p.run_dir else None,
            "started_at": p.started_at,
        }


# -----------------------------
# 모델 변환/경로 정리
# -----------------------------
def convert_model(job: Dict[str, Any]) -> Tuple[str, str]:
    """
    (model_path, data_yaml) 추출.
    - model_name/model_path: job.hyperparams.model_name -> job.model -> job.model_path 순으로 찾고,
      fast_server/models 아래에서 .pt 파일을 우선 탐색.
    - data_yaml: job.dataset_path(디렉터리) 안의 data.yaml을 우선, 명시된 yaml 경로가 있으면 그대로 사용.
    """
    hyper = job.get("hyperparams") or {}
    model_raw = (
        hyper.get("model_name")
        or job.get("model")
        or job.get("model_path")
        or "yolov8s.pt"
    )
    model_candidates = []
    # 확장자 없으면 .pt 추가 후보
    if model_raw:
        model_candidates.append(model_raw)
        if not Path(model_raw).suffix:
            model_candidates.append(f"{model_raw}.pt")
    # fast_server/models 아래 우선
    models_dir = Path(__file__).resolve().parent / "models"
    for cand in list(model_candidates):
        models_dir_candidate = models_dir / cand
        model_candidates.append(str(models_dir_candidate))

    model_path = None
    for cand in model_candidates:
        p = Path(cand).expanduser()
        if p.exists():
            model_path = str(p)
            break
    if not model_path:
        raise ValueError("job.model_path (or model) is missing or not found")

    dataset_path = (job.get("dataset_path") or job.get("data_path") or "").strip()
    data_yaml = None
    if dataset_path:
        p = Path(dataset_path).expanduser()
        if p.is_file() and p.suffix.lower() in {".yaml", ".yml"}:
            data_yaml = str(p)
        elif p.is_dir():
            for cand in [p / "data.yaml"] + list(p.glob("**/data.yaml")):
                if cand.exists():
                    data_yaml = str(cand)
                    break
    if not data_yaml:
        raise ValueError("dataset_path/data.yaml is missing")

    data_yaml = _sanitize_data_yaml(data_yaml)
    return model_path, data_yaml


# -----------------------------
# 학습 실행(핵심)
# -----------------------------
def _build_cmd(job_id: str, job: Dict[str, Any], resume: bool) -> Tuple[list, Path, int]:
    """
    Ultralytics YOLO CLI 기반:
      python -m ultralytics yolo train data=... model=... epochs=... imgsz=... project=... name=...
    - resume=True 이면 runs/<job_id>/weights/{pause,last}.pt 가 있을 때만 resume 플래그를 준다.
    """
    model_path, data_path = convert_model(job)
    hyper = job.get("hyperparams") or {}
    epochs = int(hyper.get("epochs") or job.get("epochs") or 50)
    imgsz = int(hyper.get("imgsz") or hyper.get("image_size") or job.get("imgsz") or job.get("img_size") or 640)
    device = hyper.get("device") or job.get("device") or "cpu"

    run_dir = _job_run_dir(job_id)
    # reset 전까지는 run_dir/로그/체크포인트를 유지한다.
    run_dir.mkdir(parents=True, exist_ok=True)
    # 재개는 pause 체크포인트를 우선 사용, 없으면 last.pt를 사용한다.
    weights_last = run_dir / "weights" / "last.pt"
    pause_ckpt = run_dir / "weights" / "pause.pt"
    resume_ckpt = pause_ckpt if pause_ckpt.exists() else (weights_last if weights_last.exists() else None)
    effective_resume = bool(resume and resume_ckpt and resume_ckpt.exists())

    yolo_exe = shutil.which("yolo") or "yolo"

    cmd = [
        yolo_exe,
        "train",
        f"data={data_path}",
        f"model={model_path if not effective_resume else str(resume_ckpt)}",
        f"epochs={epochs}",
        f"imgsz={imgsz}",
        f"device={device}",
        f"project={str(_runs_root())}",
        f"name={job_id}",
        "exist_ok=True",
        "verbose=True",
        "plots=False",
    ]

    if effective_resume:
        cmd.append("resume=True")

    return cmd, run_dir, epochs


def _monitor_results_csv(job_id: str, run_dir: Path, stop_event: threading.Event, total_epochs: Optional[int] = None) -> None:
    """
    Ultralytics는 run_dir/results.csv 를 생성함.
    주기적으로 읽어서 epoch별 지표를 progress_col.metrics 로 반영.
    """
    results = run_dir / "results.csv"
    last_mtime = 0.0

    while not stop_event.is_set():
        try:
            if results.exists():
                mtime = results.stat().st_mtime
                if mtime != last_mtime:
                    last_mtime = mtime
                    _parse_results_csv(job_id, results, total_epochs)
        except Exception as e:
            _append_log(job_id, f"[metrics] failed to read results.csv: {e}")
        time.sleep(1.0)


def _parse_results_csv(job_id: str, results_csv: Path, total_epochs: Optional[int] = None) -> None:
    import csv

    with results_csv.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            epoch_raw = row.get("epoch") or row.get("Epoch") or ""
            try:
                epoch = int(float(epoch_raw))
                if epoch == 0:
                    epoch = 1
            except Exception:
                continue

            def _f(key: str) -> Optional[float]:
                v = row.get(key)
                if v is None or v == "":
                    return None
                try:
                    return float(v)
                except Exception:
                    return None

            # YOLO detection 기준: loss는 여러개라 합으로 묶음
            train_loss = sum(
                x for x in [
                    _f("train/box_loss"),
                    _f("train/cls_loss"),
                    _f("train/dfl_loss"),
                    _f("train/loss"),
                ] if x is not None
            ) or None

            val_loss = sum(
                x for x in [
                    _f("val/box_loss"),
                    _f("val/cls_loss"),
                    _f("val/dfl_loss"),
                    _f("val/loss"),
                ] if x is not None
            ) or None

            # acc는 분류일 때만 있을 수도 있음
            train_acc = _f("metrics/accuracy_top1") or _f("train/acc") or _f("train/accuracy")
            val_acc = _f("metrics/accuracy_top1") or _f("val/acc") or _f("val/accuracy")

            map50 = _f("metrics/mAP50") or _f("metrics/mAP50(B)") or _f("metrics/mAP50-50")
            map50_95 = (
                _f("metrics/mAP50-95")
                or _f("metrics/mAP50-95(B)")
                or _f("metrics/mAP50-95(B)")
            )
            precision = _f("metrics/precision") or _f("metrics/precision(B)")
            recall = _f("metrics/recall") or _f("metrics/recall(B)")

            _upsert_metric(
                job_id,
                {
                    "epoch": epoch,
                    "train_loss": train_loss,
                    "val_loss": val_loss,
                    "train_acc": train_acc,
                    "val_acc": val_acc,
                    "map50": map50,
                    "map50_95": map50_95,
                    "precision": precision,
                    "recall": recall,
                    "total_epochs": total_epochs,
                },
            )


def _monitor_stop(job_id: str, stop_event: threading.Event) -> None:
    """Handle pause/stop requests without clearing any logs/metrics."""
    while not stop_event.is_set():
        with _LOCK:
            jp = _JOB_PROC.get(job_id)
            if not jp:
                return
            stop_mode = jp.stop_mode
            stop_sent = jp.stop_sent
            pause_epoch = jp.pause_requested_epoch

        if not stop_mode:
            time.sleep(0.5)
            continue

        if stop_mode == "pause":
            if pause_epoch is None:
                pause_epoch = _current_epoch(job_id)
                with _LOCK:
                    jp = _JOB_PROC.get(job_id)
                    if jp:
                        jp.pause_requested_epoch = pause_epoch
            cur_epoch = _current_epoch(job_id)
            if cur_epoch > (pause_epoch or 0) and not stop_sent:
                with _LOCK:
                    jp = _JOB_PROC.get(job_id)
                    if jp and not jp.stop_sent:
                        _send_sigint(jp.popen)
                        jp.stop_sent = True
        elif stop_mode == "stop":
            if not stop_sent:
                with _LOCK:
                    jp = _JOB_PROC.get(job_id)
                    if jp and not jp.stop_sent:
                        _send_sigint(jp.popen)
                        jp.stop_sent = True
        elif stop_mode == "reset":
            if not stop_sent:
                with _LOCK:
                    jp = _JOB_PROC.get(job_id)
                    if jp and not jp.stop_sent:
                        try:
                            jp.popen.kill()
                        except Exception:
                            pass
                        jp.stop_sent = True
        time.sleep(0.5)


def run_training(job_id: str, resume_mode: bool = False) -> None:
    """
    BackgroundTasks에서 호출됨.
    - stdout 로그 저장
    - results.csv 기반으로 metrics 업데이트
    - pause/stop/reset 신호를 받아서 상태를 정확히 갱신
    """
    with _LOCK:
        if JOB_ACTIVE.get(job_id):
            return
        JOB_ACTIVE[job_id] = True

    log_fp = None
    stop_event: Optional[threading.Event] = None
    try:
        # progress doc 준비 (resume라도 기존 데이터를 절대 지우지 않음)
        base_doc = _progress_doc(job_id)
        base_doc.pop("job_id", None)
        progress_col.update_one(
            {"_id": _oid(job_id)},
            {"$setOnInsert": base_doc, "$set": {"job_id": job_id, "created_at": _now()}},
            upsert=True,
        )
        progress_col.update_one(
            {"_id": _oid(job_id)},
            {"$set": {"status": "running", "updated_at": _now(), "job_id": job_id}},
            upsert=True,
        )
        if not resume_mode:
            progress_col.update_one(
                {"_id": _oid(job_id)},
                {
                    "$set": {
                        "run_id": uuid.uuid4().hex,
                        "epoch": 0,
                        "last_epoch": 0,
                        "progress": 0.0,
                        "train_loss": [],
                        "val_loss": [],
                        "train_accuracy": [],
                        "val_accuracy": [],
                        "history": {
                            "train_loss": [],
                            "val_loss": [],
                            "train_accuracy": [],
                            "val_accuracy": [],
                        },
                        "metrics": [],
                        "updated_at": _now(),
                        "job_id": job_id,
                    }
                },
                upsert=True,
            )

        job = jobs_col.find_one({"_id": _oid(job_id)})
        if not job:
            with _LOCK:
                JOB_ACTIVE.pop(job_id, None)
            return

        cmd, run_dir, total_epochs = _build_cmd(job_id, job, resume_mode)
        cmd_line = f"[cmd] {' '.join(cmd)}"
        _append_log(job_id, cmd_line)
        print(cmd_line, flush=True)
        progress_col.update_one(
            {"_id": _oid(job_id)},
            {"$set": {"total_epochs": total_epochs, "updated_at": _now(), "job_id": job_id}},
            upsert=True,
        )

        stop_event = threading.Event()
        log_file_path = _runs_root() / f"job_{job_id}.log"
        log_fp = log_file_path.open("a", encoding="utf-8", errors="ignore")

        popen = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=str(run_dir),
            env=os.environ.copy(),
        )

        with _LOCK:
            _JOB_PROC[job_id] = JobProc(
                popen=popen,
                mode="resume" if resume_mode else "run",
                stop_mode=None,
                stop_sent=False,
                pause_requested_epoch=None,
                run_dir=run_dir,
                started_at=_now(),
            )

        metrics_thread = threading.Thread(
            target=_monitor_results_csv,
            args=(job_id, run_dir, stop_event, total_epochs),
            daemon=True,
        )
        metrics_thread.start()

        stop_thread = threading.Thread(
            target=_monitor_stop,
            args=(job_id, stop_event),
            daemon=True,
        )
        stop_thread.start()

        # stdout 읽기
        try:
            if popen.stdout:
                for line in popen.stdout:
                    line = line.rstrip("\n")
                    if line:
                        _append_log(job_id, line)
                        print(line, flush=True)
                        try:
                            log_fp.write(line + "\n")
                            log_fp.flush()
                        except Exception:
                            pass
                    with _LOCK:
                        jp = _JOB_PROC.get(job_id)
                        if jp and jp.stop_mode == "reset":
                            break
        except Exception as e:
            _append_log(job_id, f"[runner] stdout read error: {e}")
            try:
                log_fp.write(f"[runner] stdout read error: {e}\n")
                log_fp.flush()
            except Exception:
                pass

        # 프로세스 종료 대기
        rc = None
        try:
            rc = popen.wait(timeout=10)
        except Exception:
            try:
                popen.terminate()
            except Exception:
                pass
            try:
                rc = popen.wait(timeout=5)
            except Exception:
                try:
                    popen.kill()
                except Exception:
                    pass
                rc = popen.wait()

        if stop_event:
            stop_event.set()

        # 종료 후 상태 결정
        with _LOCK:
            jp = _JOB_PROC.get(job_id)
            stop_mode = jp.stop_mode if jp else None

        # pause 요청이라면 마지막 체크포인트를 pause.pt로 복사해 둔다 (resume 전용)
        if stop_mode == "pause":
            try:
                weights_dir = run_dir / "weights"
                last_ckpt = weights_dir / "last.pt"
                pause_ckpt = weights_dir / "pause.pt"
                if last_ckpt.exists():
                    pause_ckpt.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(last_ckpt, pause_ckpt)
            except Exception as e:
                _append_log(job_id, f"[pause] failed to copy last->pause: {e}")

        if stop_mode == "pause":
            update_job(job_id, status="paused", error_message=None)
            progress_col.update_one(
                {"_id": _oid(job_id)},
                {"$set": {"status": "paused", "updated_at": _now(), "job_id": job_id}},
                upsert=True,
            )
            _append_log(job_id, "[state] paused")
        elif stop_mode == "stop":
            update_job(job_id, status="stopped", error_message=None)
            progress_col.update_one(
                {"_id": _oid(job_id)},
                {"$set": {"status": "stopped", "updated_at": _now(), "job_id": job_id}},
                upsert=True,
            )
            _append_log(job_id, "[state] stopped")
        elif stop_mode == "reset":
            update_job(job_id, status="queued", error_message=None)
            progress_col.update_one(
                {"_id": _oid(job_id)},
                {"$set": {"status": "queued", "updated_at": _now(), "job_id": job_id}},
                upsert=True,
            )
            _append_log(job_id, "[state] reset -> queued")
        else:
            if rc == 0:
                model_path = None
                weights_dir = run_dir / "weights"
                for name in ["best.pt", "last.pt"]:
                    candidate = weights_dir / name
                    if candidate.exists():
                        model_path = str(candidate)
                        break
                update_fields: Dict[str, Any] = {"status": "completed", "error_message": None, "progress": 100.0}
                if model_path:
                    update_fields["model_path"] = model_path
                update_job(job_id, **update_fields)
                progress_col.update_one(
                    {"_id": _oid(job_id)},
                    {"$set": {"status": "completed", "updated_at": _now(), "progress": 100.0, "job_id": job_id}},
                    upsert=True,
                )
                _append_log(job_id, "[state] completed")
            else:
                mark_failed(job_id, f"training exited with code={rc}")
                progress_col.update_one(
                    {"_id": _oid(job_id)},
                    {"$set": {"status": "failed", "updated_at": _now(), "job_id": job_id}},
                    upsert=True,
                )
                _append_log(job_id, f"[state] failed (code={rc})")

    except Exception as e:
        _append_log(job_id, f"[runner] error: {e}")
        mark_failed(job_id, str(e))
        progress_col.update_one(
            {"_id": _oid(job_id)},
            {"$set": {"status": "failed", "updated_at": _now(), "error_message": str(e), "job_id": job_id}},
            upsert=True,
        )
    finally:
        if stop_event:
            stop_event.set()
        with _LOCK:
            JOB_ACTIVE.pop(job_id, None)
            _JOB_PROC.pop(job_id, None)
        if log_fp:
            try:
                log_fp.close()
            except Exception:
                pass


def signal_stop(job_id: str, mode: str = "stop") -> Dict[str, Any]:
    """
    mode:
      - "pause": 저장 유도하며 멈춤(SIGINT)
      - "stop": 중지(SIGINT)
      - "reset": 즉시 강제 종료 + progress/runs 정리 + queued 초기화
    """
    mode = (mode or "").lower().strip()
    if mode not in {"pause", "stop", "reset"}:
        mode = "stop"

    with _LOCK:
        jp = _JOB_PROC.get(job_id)
        if not jp:
            if mode == "reset":
                _do_reset(job_id)
            elif mode == "pause":
                update_job(job_id, status="paused", error_message=None)
                progress_col.update_one(
                    {"_id": _oid(job_id)},
                    {"$set": {"status": "paused", "updated_at": _now(), "job_id": job_id}},
                    upsert=True,
                )
            else:
                update_job(job_id, status="stopped", error_message=None)
                progress_col.update_one(
                    {"_id": _oid(job_id)},
                    {"$set": {"status": "stopped", "updated_at": _now(), "job_id": job_id}},
                    upsert=True,
                )
            return {"ok": True, "active": False, "mode": mode}

        jp.stop_mode = mode
        jp.stop_sent = False
        if mode == "pause":
            jp.pause_requested_epoch = _current_epoch(job_id)
        popen = jp.popen

    if mode == "reset":
        try:
            popen.kill()
        except Exception:
            pass
        _do_reset(job_id)
        return {"ok": True, "active": True, "mode": mode}

    return {"ok": True, "active": True, "mode": mode}


def _do_reset(job_id: str) -> None:
    # 1) runs 폴더 삭제
    try:
        run_dir = _job_run_dir(job_id)
        import shutil
        shutil.rmtree(run_dir, ignore_errors=True)
    except Exception as e:
        _append_log(job_id, f"[reset] failed to remove run dir: {e}")

    # 2) progress 제거(그래프/로그 완전 초기화)
    progress_col.delete_one({"_id": _oid(job_id)})

    # 3) job 상태 queued 로
    update_job(job_id, status="queued", error_message=None)
