// src/helpers/training.js
const { getDb, toObjectId } = require("../db/mongo");
const { ObjectId } = require("mongodb");

const JOBS_COLLECTION = process.env.JOBS_COLLECTION || "jobs";
const PROGRESS_COLLECTION = process.env.PROGRESS_COLLECTION || "progress";

/**
 * Job 상태 업데이트
 */
async function updateJob(jobId, updates) {
  const db = getDb();
  const jobsCol = db.collection(JOBS_COLLECTION);
  
  const updateDoc = {
    ...updates,
    updated_at: new Date(),
  };
  
  await jobsCol.updateOne(
    { _id: toObjectId(jobId) },
    { $set: updateDoc }
  );
}

/**
 * Job을 running 상태로 변경
 */
async function markJobRunning(jobId) {
  await updateJob(jobId, { status: "running" });
}

/**
 * Job을 completed 상태로 변경
 */
async function markJobCompleted(jobId, metrics, modelPath) {
  await updateJob(jobId, {
    status: "completed",
    progress: 100.0,
    metrics: metrics || null,
    model_path: modelPath || null,
  });
}

/**
 * Job을 failed 상태로 변경
 */
async function markJobFailed(jobId, errorMessage) {
  await updateJob(jobId, {
    status: "failed",
    error_message: errorMessage,
  });
}

/**
 * 실제 학습 실행 함수
 * 백그라운드에서 실행되며, 각 epoch마다 progress를 업데이트합니다.
 */
async function runTraining(jobId) {
  try {
    const db = getDb();
    const jobsCol = db.collection(JOBS_COLLECTION);
    const progressCol = db.collection(PROGRESS_COLLECTION);
    
    // DB에서 job 정보 조회
    const jobDoc = await jobsCol.findOne({ _id: toObjectId(jobId) });
    if (!jobDoc) {
      throw new Error(`Job ${jobId} not found`);
    }
    
    const hyperparams = jobDoc.hyperparams || {};
    const totalEpochs = hyperparams.epochs || 10;
    
    // running 상태로 변경
    await markJobRunning(jobId);
    
    // 학습 루프 (시뮬레이션)
    for (let epoch = 0; epoch < totalEpochs; epoch++) {
      // ==== 여기 안을 실제 학습 루프로 교체하면 됨 ====
      // 예: await trainOneEpoch(model, dataloader, ...)
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 1초 딜레이 (시뮬레이션)
      // =================================================
      
      const progress = ((epoch + 1) / totalEpochs) * 100.0;
      
      // jobs 컬렉션 업데이트
      await updateJob(jobId, { progress });
      
      // progress 컬렉션에 문서 저장 (Change Stream 감지용)
      const fakeLoss = 1.0 - ((epoch + 1) / totalEpochs) * 0.8; // 시뮬레이션 loss
      const fakeAccuracy = ((epoch + 1) / totalEpochs) * 0.9; // 시뮬레이션 accuracy
      
      const progressDoc = {
        job_id: jobId,
        progress: progress,
        epoch: epoch + 1,
        total_epochs: totalEpochs,
        loss: fakeLoss,
        accuracy: fakeAccuracy,
        status: "running",
        created_at: new Date(),
        updated_at: new Date(),
      };
      
      // upsert로 저장 (같은 job_id가 있으면 업데이트, 없으면 생성)
      await progressCol.updateOne(
        { job_id: jobId },
        { $set: progressDoc },
        { upsert: true }
      );
    }
    
    // 학습이 끝났다고 가정하고 결과/모델 경로 예시로 세팅
    const fakeMetrics = {
      final_loss: 0.1234,
      final_accuracy: 0.9876,
    };
    const fakeModelPath = `/models/${jobId}.pt`;
    
    await markJobCompleted(jobId, fakeMetrics, fakeModelPath);
    
    // 최종 progress 문서 업데이트 (completed 상태)
    await progressCol.updateOne(
      { job_id: jobId },
      {
        $set: {
          status: "completed",
          progress: 100.0,
          updated_at: new Date(),
        },
      }
    );
  } catch (err) {
    console.error(`Training error for job ${jobId}:`, err.message);
    // 에러 발생 시 failed 상태로 저장
    await markJobFailed(jobId, err.message);
  }
}

module.exports = {
  runTraining,
  markJobRunning,
  markJobCompleted,
  markJobFailed,
  updateJob,
};

