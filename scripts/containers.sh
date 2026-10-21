#!/bin/sh
# Rootless Podman wrapper; application tools run inside project containers.
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$ROOT"

PROJECT=my-goat-journey
BIND_ADDRESS=0.0.0.0
DEV=localhost/my-goat-journey-dev:local
E2E=localhost/my-goat-journey-e2e:local
PROD=localhost/my-goat-journey-runtime:local

# Arguments: resource kind (network or volume), resource name.
ensure_resource() {
    if podman "$1" exists "$2"; then
        return 0
    else
        resource_status=$?
    fi

    if [ "$resource_status" -eq 1 ]; then
        podman "$1" create "$2"
    else
        printf 'Unable to check project %s: %s (Podman exit %s)\n' "$1" "$2" "$resource_status" >&2
        exit "$resource_status"
    fi
}

resources() {
    ensure_resource network "$PROJECT"
    ensure_resource volume "$PROJECT-deps"
    ensure_resource volume "$PROJECT-cache"
}

tool() {
    if [ "${SITE_PREFIX+x}" = x ]; then
        set -- -e "SITE_PREFIX=$SITE_PREFIX" "$DEV" "$@"
    else
        set -- "$DEV" "$@"
    fi

    podman run --rm --userns=keep-id --network "$PROJECT" --label app="$PROJECT" \
        -v "$ROOT:/workspace:z" \
        -v "$PROJECT-deps:/workspace/node_modules:U" \
        -v "$PROJECT-cache:/npm-cache:U" \
        "$@"
}

resolve_prefix() {
    SITE_PREFIX=$(tool node config/site.mjs prefix)
    export SITE_PREFIX
}

require_owner() {
    owner=$(podman container inspect --format '{{ index .Config.Labels "app" }}' "$1")
    if [ "$owner" != "$PROJECT" ]; then
        printf 'Refusing to manage non-project container: %s\n' "$1" >&2
        exit 1
    fi
}

stop_confirmed() {
    if podman stop "$1"; then
        return 0
    else
        stop_code=$?
    fi

    stopped_state=$(podman container inspect --format '{{.State.Status}}' "$1")
    case "$stopped_state" in
        exited|stopped)
            printf 'Confirmed stopped: %s; Podman cleanup warning remains above.\n' "$1" >&2
            return 0
            ;;
        *)
            return "$stop_code"
            ;;
    esac
}

# Arguments: container name, image reference, container TCP port, host port.
# Sets reuse_container=true only after every reuse check succeeds.
# Call directly, not in a conditional, so set -e protects dependent inspection reads.
refresh_container() {
    name=$1
    image=$2
    reuse_container=false
    if podman container exists "$name"; then
        require_owner "$name"
        current=$(podman container inspect --format '{{.Image}}' "$name")
        desired=$(podman image inspect --format '{{.Id}}' "$image")

        # A missing binding is empty on successful inspection, not an engine error.
        current_binding=$(
            podman container inspect \
                --format '{{range (index .NetworkSettings.Ports "'"$3"'/tcp")}}{{.HostIP}}:{{.HostPort}}{{println}}{{end}}' \
                "$name"
        )
        current_prefix=$(podman container inspect --format '{{ index .Config.Labels "site.prefix" }}' "$name")

        # Runtime has no source mount; only development must match this checkout.
        current_source=$ROOT
        if [ "$name" = "$PROJECT-dev" ]; then
            current_source=$(
                podman container inspect \
                    --format '{{range .Mounts}}{{if and (eq .Destination "/workspace") (eq .Type "bind")}}{{.Source}}{{end}}{{end}}' \
                    "$name"
            )
            if [ -n "$current_source" ] && [ -d "$current_source" ]; then
                current_source=$(CDPATH='' cd -- "$current_source" && pwd -P)
            fi
        fi

        if [ "$current" != "$desired" ] ||
            [ "$current_binding" != "$BIND_ADDRESS:$4" ] ||
            [ "$current_prefix" != "$SITE_PREFIX" ] ||
            [ "$current_source" != "$ROOT" ]; then
            stop_confirmed "$name"
            podman rm "$name"
        else
            reuse_container=true
        fi
    else
        exists_status=$?
        if [ "$exists_status" -ne 1 ]; then
            printf 'Unable to check project container: %s (Podman exit %s)\n' "$name" "$exists_status" >&2
            exit "$exists_status"
        fi
    fi
}

case "${1:-help}" in
    bootstrap)
        if [ ! -f package-lock.json ]; then
            printf '%s%s\n' \
                'Missing package-lock.json. Maintainer: review dependencies and run ' \
                'sh scripts/containers.sh lock-update, then retry bootstrap.' >&2
            exit 1
        fi
        resources
        podman build --target development -t "$DEV" -f Containerfile .
        if ! tool npm ci; then
            printf '%s%s%s\n' \
                'npm ci failed. Check the error above (including network errors). ' \
                'If package.json and package-lock.json disagree, maintainer: review and run ' \
                'sh scripts/containers.sh lock-update; normal bootstrap never updates the lock.' >&2
            exit 1
        fi
        podman build -t "$E2E" -f Containerfile.e2e .
        ;;
    lock-update)
        resources
        tool npm install --package-lock-only --ignore-scripts
        ;;
    dev)
        resources
        resolve_prefix
        refresh_container "$PROJECT-dev" "$DEV" 5173 5173
        if [ "$reuse_container" = true ]; then
            podman start "$PROJECT-dev"
        else
            podman run -d --name "$PROJECT-dev" \
                --label app="$PROJECT" --label "site.prefix=$SITE_PREFIX" \
                -e "SITE_PREFIX=$SITE_PREFIX" --userns=keep-id \
                --network "$PROJECT" -p "$BIND_ADDRESS:5173:5173" \
                -v "$ROOT:/workspace:z" \
                -v "$PROJECT-deps:/workspace/node_modules:U" \
                -v "$PROJECT-cache:/npm-cache:U" \
                "$DEV"
        fi
        ;;
    stop)
        stop_status=0
        for name in "$PROJECT-dev" "$PROJECT-runtime"; do
            if podman container exists "$name"; then
                require_owner "$name"
                stop_confirmed "$name" || stop_status=$?
            else
                exists_status=$?
                if [ "$exists_status" -ne 1 ]; then
                    printf 'Unable to check project container: %s (Podman exit %s)\n' "$name" "$exists_status" >&2
                    stop_status=$exists_status
                fi
            fi
        done
        exit "$stop_status"
        ;;
    format:check|format|lint|typecheck|test|build)
        resources
        tool npm run "$1"
        ;;
    audit)
        resources
        tool npm audit --json
        ;;
    tool)
        shift
        resources
        tool "$@"
        ;;
    e2e)
        shift
        resources
        resolve_prefix
        podman run --rm --userns=keep-id --network "$PROJECT" \
            --label app="$PROJECT" --shm-size=512m \
            -e "SITE_PREFIX=$SITE_PREFIX" \
            -e BASE_URL="${BASE_URL:-http://my-goat-journey-dev:5173}" \
            -v "$ROOT:/workspace:z" \
            -v "$PROJECT-deps:/workspace/node_modules:U" \
            "$E2E" npm run e2e -- "$@"
        ;;
    build-prod)
        resources
        resolve_prefix
        tool npm run typecheck
        tool npm run build
        podman build --format docker --target runtime \
            --build-arg "SITE_PREFIX=$SITE_PREFIX" -t "$PROD" -f Containerfile .
        ;;
    run-prod)
        resources
        resolve_prefix
        image_prefix=$(podman image inspect --format '{{ index .Config.Labels "site.prefix" }}' "$PROD")
        if [ "$image_prefix" != "$SITE_PREFIX" ]; then
            printf 'Runtime image prefix %s does not match %s. Run build-prod with this SITE_PREFIX first.\n' \
                "$image_prefix" "$SITE_PREFIX" >&2
            exit 1
        fi
        refresh_container "$PROJECT-runtime" "$PROD" 8080 8088
        if [ "$reuse_container" = true ]; then
            podman start "$PROJECT-runtime"
        else
            podman run -d --name "$PROJECT-runtime" \
                --label app="$PROJECT" --label "site.prefix=$SITE_PREFIX" \
                --network "$PROJECT" -p "$BIND_ADDRESS:8088:8080" \
                "$PROD"
        fi
        ;;
    *)
        printf '%s%s\n' \
            'Usage: sh scripts/containers.sh {bootstrap|lock-update|dev|stop|' \
            'format:check|format|lint|typecheck|test|build|audit|tool|e2e|build-prod|run-prod}'
        exit 2
        ;;
esac
