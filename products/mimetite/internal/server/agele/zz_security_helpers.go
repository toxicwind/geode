package agele

import "github.com/toxicwind/mimetite/internal/config"

// securityOrZero resolves Config.Security, which is a POINTER in mimetite
// (mimetite's shape) but a value in agele. A nil pointer means "no security
// block in the config", which is the zero value.
func securityOrZero(cfg config.Config) config.SecurityConfig {
	if cfg.Security == nil {
		return config.SecurityConfig{}
	}
	return *cfg.Security
}

// securityCORS is the CORS policy of the config, nil-safe.
func securityCORS(cfg config.Config) config.CORSConfig {
	return securityOrZero(cfg).CORS
}
