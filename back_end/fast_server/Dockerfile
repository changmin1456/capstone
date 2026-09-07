FROM python:3.11-slim

WORKDIR /workspace/back_end/fast_server

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY fast_server/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
RUN pip uninstall -y opencv-python || true \
 && pip install --no-cache-dir --force-reinstall opencv-python-headless

COPY fast_server ./
RUN mkdir -p ../saved_models

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
