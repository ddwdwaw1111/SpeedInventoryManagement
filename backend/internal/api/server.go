package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"speed-inventory-management/backend/internal/service"
)

type Server struct {
	store             *service.Store
	sessionCookieName string
}

func NewHandler(store *service.Store, frontendOrigin string, sessionCookieName string) http.Handler {
	server := &Server{store: store, sessionCookieName: sessionCookieName}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", server.handleHealth)
	mux.HandleFunc("/api/auth/signup", server.handleSignUp)
	mux.HandleFunc("/api/auth/login", server.handleLogin)
	mux.HandleFunc("/api/auth/me", server.requireAuth(server.handleMe))
	mux.HandleFunc("/api/auth/logout", server.handleLogout)
	mux.HandleFunc("/api/dashboard", server.requireAuth(server.handleDashboard))
	mux.HandleFunc("/api/locations", server.requireAuth(server.handleLocations))
	mux.HandleFunc("/api/locations/", server.requireAuth(server.handleLocationByID))
	mux.HandleFunc("/api/items", server.requireAuth(server.handleItems))
	mux.HandleFunc("/api/items/", server.requireAuth(server.handleItemByID))
	mux.HandleFunc("/api/movements", server.requireAuth(server.handleMovements))
	mux.HandleFunc("/api/movements/", server.requireAuth(server.handleMovementByID))

	return withCORS(frontendOrigin, mux)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
		"time":   time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	dashboard, err := s.store.GetDashboard(r.Context())
	if err != nil {
		writeServerError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, dashboard)
}

func (s *Server) handleLocations(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleListLocations(w, r)
	case http.MethodPost:
		s.handleCreateLocation(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleLocationByID(w http.ResponseWriter, r *http.Request) {
	locationID, err := parseIDFromPath(r.URL.Path, "/api/locations/")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	switch r.Method {
	case http.MethodPut:
		s.handleUpdateLocation(w, r, locationID)
	case http.MethodDelete:
		s.handleDeleteLocation(w, r, locationID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleListLocations(w http.ResponseWriter, r *http.Request) {
	locations, err := s.store.ListLocations(r.Context())
	if err != nil {
		writeServerError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, locations)
}

func (s *Server) handleCreateLocation(w http.ResponseWriter, r *http.Request) {
	var input service.CreateLocationInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	location, err := s.store.CreateLocation(r.Context(), input)
	if err != nil {
		writeDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, location)
}

func (s *Server) handleUpdateLocation(w http.ResponseWriter, r *http.Request, locationID int64) {
	var input service.CreateLocationInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	location, err := s.store.UpdateLocation(r.Context(), locationID, input)
	if err != nil {
		writeDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, location)
}

func (s *Server) handleDeleteLocation(w http.ResponseWriter, r *http.Request, locationID int64) {
	if err := s.store.DeleteLocation(r.Context(), locationID); err != nil {
		writeDomainError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleItems(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleListItems(w, r)
	case http.MethodPost:
		s.handleCreateItem(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleItemByID(w http.ResponseWriter, r *http.Request) {
	itemID, err := parseIDFromPath(r.URL.Path, "/api/items/")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	switch r.Method {
	case http.MethodPut:
		s.handleUpdateItem(w, r, itemID)
	case http.MethodDelete:
		s.handleDeleteItem(w, r, itemID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleMovements(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleListMovements(w, r)
	case http.MethodPost:
		s.handleCreateMovement(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleMovementByID(w http.ResponseWriter, r *http.Request) {
	movementID, err := parseIDFromPath(r.URL.Path, "/api/movements/")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	switch r.Method {
	case http.MethodPut:
		s.handleUpdateMovement(w, r, movementID)
	case http.MethodDelete:
		s.handleDeleteMovement(w, r, movementID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleListItems(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()

	var locationID int64
	if value := query.Get("locationId"); value != "" {
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "locationId must be a number")
			return
		}
		locationID = parsed
	}

	items, err := s.store.ListItems(r.Context(), service.ItemFilters{
		Search:       query.Get("search"),
		LocationID:   locationID,
		LowStockOnly: strings.EqualFold(query.Get("lowStock"), "true"),
	})
	if err != nil {
		writeServerError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateItem(w http.ResponseWriter, r *http.Request) {
	var input service.CreateItemInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	item, err := s.store.CreateItem(r.Context(), input)
	if err != nil {
		writeDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleUpdateItem(w http.ResponseWriter, r *http.Request, itemID int64) {
	var input service.CreateItemInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	item, err := s.store.UpdateItem(r.Context(), itemID, input)
	if err != nil {
		writeDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteItem(w http.ResponseWriter, r *http.Request, itemID int64) {
	if err := s.store.DeleteItem(r.Context(), itemID); err != nil {
		writeDomainError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListMovements(w http.ResponseWriter, r *http.Request) {
	limit := 12
	if value := r.URL.Query().Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeError(w, http.StatusBadRequest, "limit must be a number")
			return
		}
		limit = parsed
	}

	movements, err := s.store.ListMovements(r.Context(), limit)
	if err != nil {
		writeServerError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, movements)
}

func (s *Server) handleCreateMovement(w http.ResponseWriter, r *http.Request) {
	var input service.CreateMovementInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	movement, err := s.store.CreateMovement(r.Context(), input)
	if err != nil {
		writeDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, movement)
}

func (s *Server) handleUpdateMovement(w http.ResponseWriter, r *http.Request, movementID int64) {
	var input service.CreateMovementInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	movement, err := s.store.UpdateMovement(r.Context(), movementID, input)
	if err != nil {
		writeDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, movement)
}

func (s *Server) handleDeleteMovement(w http.ResponseWriter, r *http.Request, movementID int64) {
	if err := s.store.DeleteMovement(r.Context(), movementID); err != nil {
		writeDomainError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func decodeJSON(r *http.Request, destination any) error {
	defer r.Body.Close()

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(destination); err != nil {
		return err
	}

	return nil
}

func parseIDFromPath(path string, prefix string) (int64, error) {
	value := strings.TrimPrefix(path, prefix)
	value = strings.Trim(value, "/")
	if value == "" || strings.Contains(value, "/") {
		return 0, errors.New("invalid resource id")
	}

	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("invalid resource id")
	}

	return id, nil
}

func withCORS(frontendOrigin string, next http.Handler) http.Handler {
	allowedOrigin := frontendOrigin
	if allowedOrigin == "" {
		allowedOrigin = "*"
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Credentials", "true")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, statusCode int, message string) {
	writeJSON(w, statusCode, map[string]string{"error": message})
}

func writeDomainError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, service.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, service.ErrInsufficientStock):
		writeError(w, http.StatusConflict, err.Error())
	default:
		writeServerError(w, err)
	}
}

func writeServerError(w http.ResponseWriter, err error) {
	writeError(w, http.StatusInternalServerError, err.Error())
}
