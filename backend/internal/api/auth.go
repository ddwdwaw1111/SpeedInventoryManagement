package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"speed-inventory-management/backend/internal/service"
)

type contextKey string

const userContextKey contextKey = "authUser"

func (s *Server) handleSignUp(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var input service.RegisterUserInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	authPayload, token, err := s.store.RegisterUser(r.Context(), input)
	if err != nil {
		writeDomainError(w, err)
		return
	}

	s.setSessionCookie(w, token, authPayload.ExpiresAt)
	writeJSON(w, http.StatusCreated, authPayload)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var input service.LoginInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	authPayload, token, err := s.store.Login(r.Context(), input)
	if err != nil {
		writeDomainError(w, err)
		return
	}

	s.setSessionCookie(w, token, authPayload.ExpiresAt)
	writeJSON(w, http.StatusOK, authPayload)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	authPayload, ok := userFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	writeJSON(w, http.StatusOK, authPayload)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	if cookie, err := r.Cookie(s.sessionCookieName); err == nil {
		_ = s.store.Logout(r.Context(), cookie.Value)
	}

	s.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(s.sessionCookieName)
		if err != nil || cookie.Value == "" {
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}

		authPayload, err := s.store.GetUserBySessionToken(r.Context(), cookie.Value)
		if err != nil {
			if errors.Is(err, service.ErrNotFound) || errors.Is(err, service.ErrInvalidInput) {
				s.clearSessionCookie(w)
				writeError(w, http.StatusUnauthorized, "authentication required")
				return
			}
			writeServerError(w, err)
			return
		}

		next(w, r.WithContext(context.WithValue(r.Context(), userContextKey, authPayload)))
	}
}

func userFromContext(ctx context.Context) (service.AuthPayload, bool) {
	value := ctx.Value(userContextKey)
	authPayload, ok := value.(service.AuthPayload)
	return authPayload, ok
}

func (s *Server) setSessionCookie(w http.ResponseWriter, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     s.sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.sessionCookieSecure,
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     s.sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.sessionCookieSecure,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	})
}
