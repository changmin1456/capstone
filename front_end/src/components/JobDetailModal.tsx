import TrainModal from "./TrainModal";
import { useI18n } from "../i18n";

type Props = {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  jobId: string;
  readOnly?: boolean;
  title?: string;
  description?: string;
  model?: string;
  datasetName?: string;
  datasetPath?: string;
  epochs?: number;
  onUpdated?: () => void;
};

/**
 * Job 디테일(수정) 모달.
 *
 * 현재는 TrainModal의 detail mode를 래핑해서 "모달 책임"을 분리합니다.
 * (추후 폼/로직을 분리해도 호출부는 이 컴포넌트만 건드리면 됩니다.)
 */
export default function JobDetailModal({
  open,
  onClose,
  projectId,
  jobId,
  readOnly,
  title,
  description,
  model,
  datasetName,
  datasetPath,
  epochs,
  onUpdated,
}: Props) {
  const { t } = useI18n();

  return (
    <TrainModal
      open={open}
      onClose={onClose}
      projectId={projectId}
      jobId={jobId}
      titleText={t("train.detailTitle")}
      // 초기값은 props로 주지만, TrainModal 내부에서 /api/jobs/:id/full 로드로 보완합니다.
      initialTitle={title}
      initialDescription={description}
      initialModel={model}
      initialDatasetName={datasetName}
      initialDatasetPath={datasetPath}
      initialEpochs={epochs}
      saveLabel={t("common.apply")}
      readOnly={Boolean(readOnly)}
      onCreated={() => {
        onUpdated?.();
        onClose();
      }}
    />
  );
}
