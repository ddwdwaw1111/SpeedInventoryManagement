package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"speed-inventory-management/backend/internal/service"
)

type Server struct {
	store               *service.Store
	sessionCookieName   string
	sessionCookieSecure bool
}

func NewHandler(store *service.Store, frontendOrigin string, sessionCookieName string, sessionCookieSecure bool) http.Handler {
	server := &Server{
		store:               store,
		sessionCookieName:   sessionCookieName,
		sessionCookieSecure: sessionCookieSecure,
	}

	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery(), corsMiddleware(frontendOrigin))

	api := router.Group("/api")
	api.GET("/health", server.handleHealth)
	api.POST("/auth/signup", server.handleSignUp)
	api.POST("/auth/login", server.handleLogin)
	api.POST("/auth/logout", server.handleLogout)
	api.GET("/sku-master", server.handleListSKUMasters)
	api.POST("/sku-master", server.handleCreateSKUMaster)
	api.PUT("/sku-master/:id", server.handleUpdateSKUMaster)
	api.DELETE("/sku-master/:id", server.handleDeleteSKUMaster)

	protected := api.Group("")
	protected.Use(server.requireAuth())
	protected.GET("/auth/me", server.handleMe)
	protected.GET("/dashboard", server.handleDashboard)
	protected.GET("/customers", server.handleListCustomers)
	protected.POST("/customers", server.handleCreateCustomer)
	protected.PUT("/customers/:id", server.handleUpdateCustomer)
	protected.DELETE("/customers/:id", server.handleDeleteCustomer)
	protected.GET("/locations", server.handleListLocations)
	protected.POST("/locations", server.handleCreateLocation)
	protected.PUT("/locations/:id", server.handleUpdateLocation)
	protected.DELETE("/locations/:id", server.handleDeleteLocation)
	protected.GET("/items", server.handleListItems)
	protected.POST("/items", server.handleCreateItem)
	protected.PUT("/items/:id", server.handleUpdateItem)
	protected.DELETE("/items/:id", server.handleDeleteItem)
	protected.GET("/movements", server.handleListMovements)
	protected.POST("/movements", server.handleCreateMovement)
	protected.PUT("/movements/:id", server.handleUpdateMovement)
	protected.DELETE("/movements/:id", server.handleDeleteMovement)

	return router
}

func (s *Server) handleHealth(c *gin.Context) {
	writeJSON(c, http.StatusOK, gin.H{
		"status": "ok",
		"time":   time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleDashboard(c *gin.Context) {
	dashboard, err := s.store.GetDashboard(c.Request.Context())
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, dashboard)
}

func (s *Server) handleListCustomers(c *gin.Context) {
	customers, err := s.store.ListCustomers(c.Request.Context())
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, customers)
}

func (s *Server) handleCreateCustomer(c *gin.Context) {
	var input service.CreateCustomerInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	customer, err := s.store.CreateCustomer(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusCreated, customer)
}

func (s *Server) handleUpdateCustomer(c *gin.Context) {
	customerID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.CreateCustomerInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	customer, err := s.store.UpdateCustomer(c.Request.Context(), customerID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, customer)
}

func (s *Server) handleDeleteCustomer(c *gin.Context) {
	customerID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.store.DeleteCustomer(c.Request.Context(), customerID); err != nil {
		writeDomainError(c, err)
		return
	}

	c.Status(http.StatusNoContent)
}

func (s *Server) handleListLocations(c *gin.Context) {
	locations, err := s.store.ListLocations(c.Request.Context())
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, locations)
}

func (s *Server) handleCreateLocation(c *gin.Context) {
	var input service.CreateLocationInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	location, err := s.store.CreateLocation(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusCreated, location)
}

func (s *Server) handleUpdateLocation(c *gin.Context) {
	locationID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.CreateLocationInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	location, err := s.store.UpdateLocation(c.Request.Context(), locationID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, location)
}

func (s *Server) handleDeleteLocation(c *gin.Context) {
	locationID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.store.DeleteLocation(c.Request.Context(), locationID); err != nil {
		writeDomainError(c, err)
		return
	}

	c.Status(http.StatusNoContent)
}

func (s *Server) handleListSKUMasters(c *gin.Context) {
	skuMasters, err := s.store.ListSKUMasters(c.Request.Context(), c.Query("search"))
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, skuMasters)
}

func (s *Server) handleCreateSKUMaster(c *gin.Context) {
	var input service.CreateSKUMasterInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	skuMaster, err := s.store.CreateSKUMaster(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusCreated, skuMaster)
}

func (s *Server) handleUpdateSKUMaster(c *gin.Context) {
	skuMasterID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.CreateSKUMasterInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	skuMaster, err := s.store.UpdateSKUMaster(c.Request.Context(), skuMasterID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, skuMaster)
}

func (s *Server) handleDeleteSKUMaster(c *gin.Context) {
	skuMasterID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.store.DeleteSKUMaster(c.Request.Context(), skuMasterID); err != nil {
		writeDomainError(c, err)
		return
	}

	c.Status(http.StatusNoContent)
}

func (s *Server) handleListItems(c *gin.Context) {
	locationID, err := parseOptionalInt64Query(c, "locationId", "locationId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	customerID, err := parseOptionalInt64Query(c, "customerId", "customerId must be a number")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	items, err := s.store.ListItems(c.Request.Context(), service.ItemFilters{
		Search:       c.Query("search"),
		LocationID:   locationID,
		CustomerID:   customerID,
		LowStockOnly: strings.EqualFold(c.Query("lowStock"), "true"),
	})
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, items)
}

func (s *Server) handleCreateItem(c *gin.Context) {
	var input service.CreateItemInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	item, err := s.store.CreateItem(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusCreated, item)
}

func (s *Server) handleUpdateItem(c *gin.Context) {
	itemID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.CreateItemInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	item, err := s.store.UpdateItem(c.Request.Context(), itemID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, item)
}

func (s *Server) handleDeleteItem(c *gin.Context) {
	itemID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.store.DeleteItem(c.Request.Context(), itemID); err != nil {
		writeDomainError(c, err)
		return
	}

	c.Status(http.StatusNoContent)
}

func (s *Server) handleListMovements(c *gin.Context) {
	limit := 12
	if value := strings.TrimSpace(c.Query("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeError(c, http.StatusBadRequest, "limit must be a number")
			return
		}
		limit = parsed
	}

	movements, err := s.store.ListMovements(c.Request.Context(), limit)
	if err != nil {
		writeServerError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, movements)
}

func (s *Server) handleCreateMovement(c *gin.Context) {
	var input service.CreateMovementInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	movement, err := s.store.CreateMovement(c.Request.Context(), input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusCreated, movement)
}

func (s *Server) handleUpdateMovement(c *gin.Context) {
	movementID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	var input service.CreateMovementInput
	if err := bindJSON(c, &input); err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	movement, err := s.store.UpdateMovement(c.Request.Context(), movementID, input)
	if err != nil {
		writeDomainError(c, err)
		return
	}

	writeJSON(c, http.StatusOK, movement)
}

func (s *Server) handleDeleteMovement(c *gin.Context) {
	movementID, err := parseIDParam(c, "id")
	if err != nil {
		writeError(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.store.DeleteMovement(c.Request.Context(), movementID); err != nil {
		writeDomainError(c, err)
		return
	}

	c.Status(http.StatusNoContent)
}

func bindJSON(c *gin.Context, destination any) error {
	defer c.Request.Body.Close()

	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(destination); err != nil {
		return err
	}

	return nil
}

func parseIDParam(c *gin.Context, key string) (int64, error) {
	value := strings.TrimSpace(c.Param(key))
	if value == "" {
		return 0, errors.New("invalid resource id")
	}

	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("invalid resource id")
	}

	return id, nil
}

func parseOptionalInt64Query(c *gin.Context, key string, message string) (int64, error) {
	value := strings.TrimSpace(c.Query(key))
	if value == "" {
		return 0, nil
	}

	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, errors.New(message)
	}

	return parsed, nil
}

func corsMiddleware(frontendOrigin string) gin.HandlerFunc {
	allowedOrigin := strings.TrimSpace(frontendOrigin)

	return func(c *gin.Context) {
		origin := allowedOrigin
		if origin == "" {
			origin = c.GetHeader("Origin")
			if origin == "" {
				origin = "*"
			}
		}

		headers := c.Writer.Header()
		headers.Set("Access-Control-Allow-Origin", origin)
		headers.Set("Access-Control-Allow-Headers", "Content-Type")
		headers.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		headers.Set("Access-Control-Allow-Credentials", "true")
		if origin != "*" {
			headers.Add("Vary", "Origin")
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

func writeJSON(c *gin.Context, statusCode int, payload any) {
	c.JSON(statusCode, payload)
}

func writeError(c *gin.Context, statusCode int, message string) {
	writeJSON(c, statusCode, gin.H{"error": message})
}

func writeDomainError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrNotFound):
		writeError(c, http.StatusNotFound, err.Error())
	case errors.Is(err, service.ErrInvalidInput):
		writeError(c, http.StatusBadRequest, err.Error())
	case errors.Is(err, service.ErrInsufficientStock):
		writeError(c, http.StatusConflict, err.Error())
	default:
		writeServerError(c, err)
	}
}

func writeServerError(c *gin.Context, err error) {
	writeError(c, http.StatusInternalServerError, err.Error())
}
