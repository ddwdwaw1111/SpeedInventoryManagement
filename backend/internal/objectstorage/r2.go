package objectstorage

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"speed-inventory-management/backend/internal/config"
)

const (
	r2Region  = "auto"
	r2Service = "s3"
)

type R2Client struct {
	accountID       string
	accessKeyID     string
	secretAccessKey string
	bucket          string
	endpoint        *url.URL
	httpClient      *http.Client
}

func NewR2Client(cfg config.R2Config) (*R2Client, error) {
	accountID := strings.TrimSpace(cfg.AccountID)
	accessKeyID := strings.TrimSpace(cfg.AccessKeyID)
	secretAccessKey := strings.TrimSpace(cfg.SecretAccessKey)
	bucket := strings.TrimSpace(cfg.Bucket)
	if accountID == "" || accessKeyID == "" || secretAccessKey == "" || bucket == "" {
		return nil, errors.New("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET are required")
	}

	endpointValue := strings.TrimSpace(cfg.Endpoint)
	if endpointValue == "" {
		endpointValue = fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID)
	}
	endpoint, err := url.Parse(endpointValue)
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return nil, fmt.Errorf("invalid R2 endpoint %q", endpointValue)
	}

	return &R2Client{
		accountID:       accountID,
		accessKeyID:     accessKeyID,
		secretAccessKey: secretAccessKey,
		bucket:          bucket,
		endpoint:        endpoint,
		httpClient: &http.Client{
			Timeout: 90 * time.Second,
		},
	}, nil
}

func (c *R2Client) Bucket() string {
	return c.bucket
}

func (c *R2Client) Provider() string {
	return "r2"
}

func (c *R2Client) PutObject(ctx context.Context, key string, contentType string, data []byte) error {
	if strings.TrimSpace(key) == "" {
		return errors.New("object key is required")
	}
	contentType = firstNonEmpty(strings.TrimSpace(contentType), "application/octet-stream")
	payloadHash := sha256Hex(data)
	now := time.Now().UTC()
	objectURL := c.objectURL(key)

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, objectURL.String(), bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("build R2 put request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("X-Amz-Date", amzDate(now))
	req.Header.Set("Authorization", c.authorizationHeader(http.MethodPut, objectURL, "", payloadHash, map[string]string{
		"content-type":         contentType,
		"host":                 objectURL.Host,
		"x-amz-content-sha256": payloadHash,
		"x-amz-date":           amzDate(now),
	}, now))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("upload object to R2: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("upload object to R2 failed: %s: %s", resp.Status, readSmallBody(resp.Body))
	}
	return nil
}

func (c *R2Client) DeleteObject(ctx context.Context, key string) error {
	if strings.TrimSpace(key) == "" {
		return errors.New("object key is required")
	}
	payloadHash := sha256Hex(nil)
	now := time.Now().UTC()
	objectURL := c.objectURL(key)

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, objectURL.String(), nil)
	if err != nil {
		return fmt.Errorf("build R2 delete request: %w", err)
	}
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("X-Amz-Date", amzDate(now))
	req.Header.Set("Authorization", c.authorizationHeader(http.MethodDelete, objectURL, "", payloadHash, map[string]string{
		"host":                 objectURL.Host,
		"x-amz-content-sha256": payloadHash,
		"x-amz-date":           amzDate(now),
	}, now))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("delete object from R2: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("delete object from R2 failed: %s: %s", resp.Status, readSmallBody(resp.Body))
	}
	return nil
}

func (c *R2Client) SignedGetURL(key string, expires time.Duration) (string, error) {
	if strings.TrimSpace(key) == "" {
		return "", errors.New("object key is required")
	}
	if expires <= 0 {
		expires = 10 * time.Minute
	}
	if expires > 7*24*time.Hour {
		expires = 7 * 24 * time.Hour
	}

	now := time.Now().UTC()
	objectURL := c.objectURL(key)
	scope := c.credentialScope(now)
	query := objectURL.Query()
	query.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	query.Set("X-Amz-Credential", c.accessKeyID+"/"+scope)
	query.Set("X-Amz-Date", amzDate(now))
	query.Set("X-Amz-Expires", fmt.Sprintf("%d", int64(expires.Seconds())))
	query.Set("X-Amz-SignedHeaders", "host")

	canonicalQuery := canonicalQueryString(query)
	canonicalRequest := strings.Join([]string{
		http.MethodGet,
		canonicalURI(objectURL.Path),
		canonicalQuery,
		"host:" + objectURL.Host + "\n",
		"host",
		"UNSIGNED-PAYLOAD",
	}, "\n")
	signature := c.sign(now, canonicalRequest)
	query.Set("X-Amz-Signature", signature)
	objectURL.RawQuery = query.Encode()
	return objectURL.String(), nil
}

func (c *R2Client) objectURL(key string) *url.URL {
	nextURL := *c.endpoint
	nextURL.Path = joinURLPath(c.endpoint.Path, c.bucket, key)
	nextURL.RawQuery = ""
	return &nextURL
}

func (c *R2Client) authorizationHeader(method string, objectURL *url.URL, canonicalQuery string, payloadHash string, headers map[string]string, at time.Time) string {
	signedHeaders := sortedHeaderKeys(headers)
	canonicalHeaders := buildCanonicalHeaders(headers, signedHeaders)
	canonicalRequest := strings.Join([]string{
		method,
		canonicalURI(objectURL.Path),
		canonicalQuery,
		canonicalHeaders,
		strings.Join(signedHeaders, ";"),
		payloadHash,
	}, "\n")
	signature := c.sign(at, canonicalRequest)
	return fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		c.accessKeyID,
		c.credentialScope(at),
		strings.Join(signedHeaders, ";"),
		signature,
	)
}

func (c *R2Client) sign(at time.Time, canonicalRequest string) string {
	hashedCanonicalRequest := sha256Hex([]byte(canonicalRequest))
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate(at),
		c.credentialScope(at),
		hashedCanonicalRequest,
	}, "\n")
	signingKey := deriveSigningKey(c.secretAccessKey, shortDate(at), r2Region, r2Service)
	return hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
}

func (c *R2Client) credentialScope(at time.Time) string {
	return strings.Join([]string{shortDate(at), r2Region, r2Service, "aws4_request"}, "/")
}

func deriveSigningKey(secret string, date string, region string, service string) []byte {
	dateKey := hmacSHA256([]byte("AWS4"+secret), date)
	regionKey := hmacSHA256(dateKey, region)
	serviceKey := hmacSHA256(regionKey, service)
	return hmacSHA256(serviceKey, "aws4_request")
}

func hmacSHA256(key []byte, value string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(value))
	return mac.Sum(nil)
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func amzDate(at time.Time) string {
	return at.UTC().Format("20060102T150405Z")
}

func shortDate(at time.Time) string {
	return at.UTC().Format("20060102")
}

func buildCanonicalHeaders(headers map[string]string, signedHeaders []string) string {
	var builder strings.Builder
	for _, key := range signedHeaders {
		builder.WriteString(key)
		builder.WriteByte(':')
		builder.WriteString(normalizeHeaderValue(headers[key]))
		builder.WriteByte('\n')
	}
	return builder.String()
}

func sortedHeaderKeys(headers map[string]string) []string {
	keys := make([]string, 0, len(headers))
	for key := range headers {
		keys = append(keys, strings.ToLower(strings.TrimSpace(key)))
	}
	sort.Strings(keys)
	return keys
}

func normalizeHeaderValue(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func canonicalURI(path string) string {
	if path == "" {
		return "/"
	}
	segments := strings.Split(path, "/")
	for index, segment := range segments {
		segments[index] = url.PathEscape(segment)
	}
	result := strings.Join(segments, "/")
	if !strings.HasPrefix(result, "/") {
		result = "/" + result
	}
	return result
}

func canonicalQueryString(values url.Values) string {
	type pair struct {
		key   string
		value string
	}
	pairs := make([]pair, 0)
	for key, entries := range values {
		for _, value := range entries {
			pairs = append(pairs, pair{key: key, value: value})
		}
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].key == pairs[j].key {
			return pairs[i].value < pairs[j].value
		}
		return pairs[i].key < pairs[j].key
	})
	encoded := make([]string, 0, len(pairs))
	for _, entry := range pairs {
		encoded = append(encoded, awsQueryEscape(entry.key)+"="+awsQueryEscape(entry.value))
	}
	return strings.Join(encoded, "&")
}

func awsQueryEscape(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}

func joinURLPath(parts ...string) string {
	segments := make([]string, 0, len(parts))
	for _, part := range parts {
		for _, segment := range strings.Split(part, "/") {
			if strings.TrimSpace(segment) != "" {
				segments = append(segments, segment)
			}
		}
	}
	return "/" + strings.Join(segments, "/")
}

func readSmallBody(body io.Reader) string {
	data, _ := io.ReadAll(io.LimitReader(body, 4096))
	return strings.TrimSpace(string(data))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
