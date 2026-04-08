"""
Model metadata helpers.

The original dynamic loader is gone; this file surfaces a static list so
clients can still select models for training.
"""

from typing import List, Dict


def available_models() -> List[Dict]:
    # Mirrors Node server's AVAILABLE_MODELS baseline.
    return [
        {"id": "resnet18", "name": "ResNet-18", "description": "18-layer ResNet model", "category": "classification"},
        {"id": "resnet34", "name": "ResNet-34", "description": "34-layer ResNet model", "category": "classification"},
        {"id": "resnet50", "name": "ResNet-50", "description": "50-layer ResNet model", "category": "classification"},
        {"id": "vgg16", "name": "VGG-16", "description": "16-layer VGG model", "category": "classification"},
        {"id": "vgg19", "name": "VGG-19", "description": "19-layer VGG model", "category": "classification"},
        {"id": "mobilenet_v2", "name": "MobileNet V2", "description": "MobileNet V2", "category": "classification"},
        {"id": "efficientnet_b0", "name": "EfficientNet-B0", "description": "EfficientNet-B0", "category": "classification"},
        {"id": "custom_model_1", "name": "Custom Model 1", "description": "Placeholder custom model 1", "category": "custom"},
        {"id": "custom_model_2", "name": "Custom Model 2", "description": "Placeholder custom model 2", "category": "custom"},
        {"id": "custom_model_3", "name": "Custom Model 3", "description": "Placeholder custom model 3", "category": "custom"},
    ]


def get_model(model_id: str) -> dict | None:
    for m in available_models():
        if m.get("id") == model_id:
            return m
    return None

