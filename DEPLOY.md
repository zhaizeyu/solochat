# Deployment

## Coolify with Dockerfile

Use the Dockerfile build pack and keep the Dockerfile path as `Dockerfile` at the repository root.

Required environment variables:

```env
DATABASE_URL=postgres://user:password@host:5432/solochat
R2_BUCKET=solochat
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
S3_API_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_PUBLIC_BASE_URL=https://uploads.example.com
USE_LOCAL=false
HOST=0.0.0.0
PORT=3000
```

Coolify can still render templates such as `{{ team.DATABASE_URL }}` before the container starts. The app only reads the final environment variable values.

Set `USE_LOCAL=true` to mirror R2 images into local storage on startup and serve client image URLs from `/uploads/...` when the local file exists. New uploads are also written to local storage before being uploaded to R2. The local directory defaults to `data/uploads`; set `LOCAL_UPLOADS_DIR` if you need a different mounted persistent volume.

## Local Docker

Build the image:

```sh
docker build -t solochat .
```

Run with a local `.env` file:

```sh
docker run --rm --env-file .env -e HOST=0.0.0.0 -e PORT=3000 -p 3000:3000 solochat
```

If your local `.env` uses `DATABASE_URL=...@127.0.0.1:5432/...`, the database address points inside the container. On Linux, either run with host networking:

```sh
docker run --rm --network host --env-file .env -e HOST=0.0.0.0 -e PORT=3000 solochat
```

or change the local container env to use a host-reachable database name, such as `host.docker.internal` with Docker's host-gateway mapping.
