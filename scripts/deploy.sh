#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

APPS_JSON="${1:-$script_dir/apps.json}"
BUCKET_NAME="${2:-}"
CLOUDFRONT_DISTRIBUTION_ID="${3:-}"
APP_LIST="${4:-}"

if [ -z "$BUCKET_NAME" ] || [ -z "$APP_LIST" ]; then
    echo "Usage:"
    echo "  $0 <apps.json> <bucket-name> <cloudfront-id> <app1,app2,app3>"
    echo "Example:"
    echo "  ./scripts/deploy.sh ./scripts/apps.json argus-cpd-dashboard-web-859217211726 E1PC8Z0SI4SX1O argus_cpd"
    exit 1
fi

cd "$repo_root"

IFS=',' read -ra REQUESTED_APPS <<< "$APP_LIST"

count=0

for APP_NAME in "${REQUESTED_APPS[@]}"; do

    echo
    echo "=================================================="
    echo "Processing: $APP_NAME"
    echo "=================================================="

    APP_INFO=$(node -e '
        const fs = require("fs");

        const apps = JSON.parse(
            fs.readFileSync(process.argv[1], "utf8")
        );

        const appName = process.argv[2];

        const app = apps.find(a => a.name === appName);

        if (!app) {
            process.exit(1);
        }

        console.log(JSON.stringify({
            name: app.name,
            title: app.title || app.name,
            apiBaseUrl: app.apiBaseUrl || "",
            qsDatasetIdentifier: app.qsDatasetIdentifier || "",
            qsDatasetIdentifierURL: app.qsDatasetIdentifierURL || "",
            defaultFilter: app.defaultFilter || {}
        }));
    ' "$APPS_JSON" "$APP_NAME")

    if [ -z "$APP_INFO" ]; then
        echo "App not found in apps.json: $APP_NAME"
        continue
    fi

    name=$(echo "$APP_INFO" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).name')
    title=$(echo "$APP_INFO" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).title')
    api_base_url=$(echo "$APP_INFO" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).apiBaseUrl')
    qs_dataset_identifier=$(echo "$APP_INFO" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).qsDatasetIdentifier')
    qs_dataset_identifier_url=$(echo "$APP_INFO" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).qsDatasetIdentifierURL')
    default_filter_values=$(echo "$APP_INFO" | node -pe '
        JSON.stringify(
            JSON.parse(require("fs").readFileSync(0,"utf8")).defaultFilter
        )
    ')

    echo "Cleaning local build..."

    rm -rf build
    mkdir -p build

    echo "Deleting old S3 artifacts..."

    aws s3 rm "s3://${BUCKET_NAME}/${name}.html" 2>/dev/null || true
    aws s3 rm "s3://${BUCKET_NAME}/${name}/" --recursive 2>/dev/null || true

    echo "Building..."
    echo "Default Filters: $default_filter_values"

    export VITE_APP_TITLE="$title"
    export VITE_API_BASE_URL="$api_base_url"
    export VITE_QS_DATASET_IDENTIFIER="$qs_dataset_identifier"
    export VITE_QS_DATASET_IDENTIFIER_URL="$qs_dataset_identifier_url"
    export VITE_DEFAULT_FILTER_VALUES="$default_filter_values"

    npm run build -- \
        --outDir build \
        --assetsDir "$name"

    if [ -f build/index.html ]; then
        mv build/index.html "build/${name}.html"
    fi

    echo "Uploading HTML..."

    aws s3 cp \
        "build/${name}.html" \
        "s3://${BUCKET_NAME}/${name}.html"

    echo "Uploading Assets..."

    aws s3 cp \
        build/ \
        "s3://${BUCKET_NAME}/" \
        --recursive \
        --exclude "${name}.html"

    echo "Deployed: $name"

    count=$((count + 1))

done

if [ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]; then

    echo
    echo "Creating CloudFront Invalidation..."

    INVALIDATION_ID=$(
        aws cloudfront create-invalidation \
            --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
            --paths "/*" \
            --query 'Invalidation.Id' \
            --output text
    )

    echo "Invalidation ID: $INVALIDATION_ID"
fi

echo
echo "======================================"
echo "Deployment completed"
echo "Apps deployed: $count"
echo "======================================"
