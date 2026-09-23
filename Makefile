.PHONY: all build-web build-server build clean test test-backend test-frontend

all: build

build-web:
	cd web && (bun run build || npm run build)

build-server:
	CGO_ENABLED=0 go build -ldflags="-s -w" -o media-workstage.exe ./cmd/server

build: build-web build-server

test-frontend:
	cd web && (bun test || npm test)

test-backend:
	go test -v -count=1 ./...

test: test-frontend test-backend

clean:
	rm -rf cmd/server/dist media-workstage.exe build/
