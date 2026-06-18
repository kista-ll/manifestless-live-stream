import uvicorn


def main() -> None:
    uvicorn.run(
        "manifestless_server.app:app",
        host="0.0.0.0",
        port=8000,
        log_config=None,
    )


if __name__ == "__main__":
    main()
