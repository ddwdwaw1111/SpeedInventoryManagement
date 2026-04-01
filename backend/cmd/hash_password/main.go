package main

import (
	"flag"
	"fmt"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	passwordFlag := flag.String("password", "", "Plain-text password to hash with bcrypt")
	costFlag := flag.Int("cost", 12, "bcrypt cost")
	flag.Parse()

	password := strings.TrimSpace(firstNonEmpty(*passwordFlag, os.Getenv("ADMIN_PASSWORD")))
	if password == "" {
		fmt.Fprintln(os.Stderr, "missing password: use --password or ADMIN_PASSWORD")
		os.Exit(1)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), *costFlag)
	if err != nil {
		fmt.Fprintf(os.Stderr, "bcrypt hash: %v\n", err)
		os.Exit(1)
	}

	fmt.Println(string(hash))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
