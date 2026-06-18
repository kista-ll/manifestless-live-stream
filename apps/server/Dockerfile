FROM python:3.13-slim

WORKDIR /app
COPY pyproject.toml ./
RUN python -m pip install --no-cache-dir .[dev]
COPY src ./src
COPY tests ./tests

CMD ["python", "-m", "manifestless_server"]
