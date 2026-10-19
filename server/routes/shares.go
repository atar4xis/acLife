package routes

import (
	"time"

	"acLife/constants"
	"acLife/handlers"

	"github.com/gorilla/mux"
)

func Shares(r *mux.Router) {
	sr := r.PathPrefix("/shares").Subrouter()

	sr.Use(handlers.RateLimitMiddleware(constants.RateLimitShares, time.Second))
	sr.Use(handlers.AuthMiddleware())
	sr.Use(handlers.SubscriptionMiddleware())

	manage := sr.NewRoute().Subrouter()
	manage.Use(handlers.MaxBodySizeMiddleware(8 << 10))
	manage.HandleFunc("", handlers.ListShares).Methods("GET")
	manage.HandleFunc("/spaces", handlers.CreateSpace).Methods("POST")
	manage.HandleFunc("/spaces/{id}", handlers.DeleteSpace).Methods("DELETE")
	manage.HandleFunc("/members/add", handlers.AddMember).Methods("POST")
	manage.HandleFunc("/members/accept", handlers.AcceptShare).Methods("POST")
	manage.HandleFunc("/members/decline", handlers.DeclineShare).Methods("POST")
	manage.HandleFunc("/members/permission", handlers.SetPermission).Methods("POST")
	manage.HandleFunc("/members/{space}/{user}", handlers.RemoveMember).Methods("DELETE")

	save := sr.NewRoute().Subrouter()
	save.Use(handlers.MaxBodySizeMiddleware(constants.MaxSaveBodyBytes))
	save.HandleFunc("/save", handlers.SaveShared).Methods("POST")
}
