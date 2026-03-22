package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

type contextKey string

const userContextKey contextKey = "authUser"

func (s *Server) handleSignUp(c *gin.Context) {
	var input service.RegisterUserInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	authPayload, token, err := s.store.RegisterUser(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.setSessionCookie(c, token, authPayload.ExpiresAt)
	writeJSON(c, http.StatusCreated, authPayload)
}

func (s *Server) handleLogin(c *gin.Context) {
	var input service.LoginInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	authPayload, token, err := s.store.Login(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	s.setSessionCookie(c, token, authPayload.ExpiresAt)
	writeJSON(c, http.StatusOK, authPayload)
}

func (s *Server) handleMe(c *gin.Context) {
	authPayload, ok := userFromContext(c)
	if !ok {
		writeError(c, http.StatusUnauthorized, "authentication required")
		return
	}

	writeJSON(c, http.StatusOK, authPayload)
}

func (s *Server) handleLogout(c *gin.Context) {
	if cookie, err := c.Cookie(s.sessionCookieName); err == nil {
		_ = s.store.Logout(c.Request.Context(), cookie)
	}

	s.clearSessionCookie(c)
	c.Status(http.StatusNoContent)
}

func (s *Server) requireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		cookie, err := c.Cookie(s.sessionCookieName)
		if err != nil || cookie == "" {
			writeError(c, http.StatusUnauthorized, "authentication required")
			c.Abort()
			return
		}

		authPayload, err := s.store.GetUserBySessionToken(c.Request.Context(), cookie)
		if err != nil {
			if errors.Is(err, service.ErrNotFound) || errors.Is(err, service.ErrInvalidInput) {
				s.clearSessionCookie(c)
				writeError(c, http.StatusUnauthorized, "authentication required")
				c.Abort()
				return
			}
			writeServerError(c, err)
			c.Abort()
			return
		}

		c.Set(string(userContextKey), authPayload)
		c.Next()
	}
}

func (s *Server) requireRoles(roles ...string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		allowed[role] = struct{}{}
	}

	return func(c *gin.Context) {
		authPayload, ok := userFromContext(c)
		if !ok {
			writeError(c, http.StatusUnauthorized, "authentication required")
			c.Abort()
			return
		}

		if _, ok := allowed[authPayload.User.Role]; !ok {
			writeError(c, http.StatusForbidden, "you do not have permission to perform this action")
			c.Abort()
			return
		}

		c.Next()
	}
}

func userFromContext(c *gin.Context) (service.AuthPayload, bool) {
	value, ok := c.Get(string(userContextKey))
	if !ok {
		return service.AuthPayload{}, false
	}

	authPayload, ok := value.(service.AuthPayload)
	return authPayload, ok
}

func (s *Server) setSessionCookie(c *gin.Context, token string, expiresAt time.Time) {
	http.SetCookie(c.Writer, &http.Cookie{
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

func (s *Server) clearSessionCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
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
