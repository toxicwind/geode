package config

import (
	"os"
)

// loadConfigFile is agele's config file reader, ported during the
// mimetite union so agele's config-loading behaviour is not lost.
func loadConfigFile(path string) (Config, error) {
	file, err := os.Open(path)
	if err != nil {
		return Config{}, err
	}
	defer file.Close()
	return LoadConfigFromReader(file)
}
