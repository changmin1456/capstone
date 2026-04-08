const MODEL_KEY = "capston.defaultModel";
const EPOCHS_KEY = "capston.defaultEpochs";

export type DefaultModel = "yolov8n" | "yolov8s" | "yolov8m";
export type DefaultEpochs = "50" | "100";

export const getDefaultModel = (): DefaultModel => {
  if (typeof window === "undefined") return "yolov8n";
  const stored = window.localStorage.getItem(MODEL_KEY) as DefaultModel | null;
  return stored === "yolov8n" || stored === "yolov8s" || stored === "yolov8m" ? stored : "yolov8n";
};

export const setDefaultModel = (model: DefaultModel) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MODEL_KEY, model);
};

export const getDefaultEpochs = (): DefaultEpochs => {
  if (typeof window === "undefined") return "50";
  const stored = window.localStorage.getItem(EPOCHS_KEY) as DefaultEpochs | null;
  return stored === "50" || stored === "100" ? stored : "50";
};

export const setDefaultEpochs = (epochs: DefaultEpochs) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EPOCHS_KEY, epochs);
};
