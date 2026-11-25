#!/bin/sh
# Dev only (docker-compose.dev.yml → rustfs-init): creates the bucket if it is missing and
# sets its CORS rules, because browsers PUT presigned uploads straight to it (D-037).
# Also run by CI's e2e job against its RustFS service container.
# Env: BUCKET, CORS_ORIGINS (comma-separated), the AWS_* keys, and optionally ENDPOINT.
set -eu

endpoint="${ENDPOINT:-http://rustfs:9000}"

aws --endpoint-url "$endpoint" s3api head-bucket --bucket "$BUCKET" 2>/dev/null ||
  aws --endpoint-url "$endpoint" s3api create-bucket --bucket "$BUCKET"

origins=""
for origin in $(echo "$CORS_ORIGINS" | tr ',' ' '); do
  origins="${origins:+$origins,}\"$origin\""
done

cat > /tmp/cors.json <<JSON
{"CORSRules":[{"AllowedOrigins":[$origins],"AllowedMethods":["GET","PUT","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]}
JSON

aws --endpoint-url "$endpoint" s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration file:///tmp/cors.json
echo "bucket $BUCKET ready (CORS: $CORS_ORIGINS)"
