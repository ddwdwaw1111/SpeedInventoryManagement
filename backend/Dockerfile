FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o /inventory-api ./cmd/server

FROM alpine:3.20

WORKDIR /app

COPY --from=builder /inventory-api /usr/local/bin/inventory-api

EXPOSE 8080

CMD ["inventory-api"]
