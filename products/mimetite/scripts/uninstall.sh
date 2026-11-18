#!/bin/sh
# This script uninstalls mimetite on Linux.
# It removes the binary, systemd service, config.yaml (optional), and mimetite user and group.

set -eu

red="$( (/usr/bin/tput bold || :; /usr/bin/tput setaf 1 || :) 2>&-)"
plain="$( (/usr/bin/tput sgr0 || :) 2>&-)"

status() { echo ">>> $*" >&2; }
error() { echo "${red}ERROR:${plain} $*"; exit 1; }
warning() { echo "${red}WARNING:${plain} $*"; }

available() { command -v $1 >/dev/null; }

SUDO=
if [ "$(id -u)" -ne 0 ]; then
    if ! available sudo; then
        error "This script requires superuser permissions. Please re-run as root."
    fi

    SUDO="sudo"
fi

configure_systemd() {
    status "Stopping mimetite service..."
    $SUDO systemctl stop mimetite

    status "Disabling mimetite service..."
    $SUDO systemctl disable mimetite
}
if available systemctl; then
    configure_systemd
fi

if available mimetite; then
    status "Removing mimetite binary..."
    $SUDO rm $(which mimetite)
fi

if [ -f "/usr/share/mimetite/config.yaml" ]; then
    while true; do
        printf "Delete config.yaml (/usr/share/mimetite/config.yaml)? [y/N] " >&2
        read answer
        case "$answer" in
            [Yy]* ) 
                $SUDO rm -r /usr/share/mimetite
                break
                ;;
            [Nn]* | "" ) 
                break
                ;;
            * ) 
                echo "Invalid input. Please enter y or n."
                ;;
        esac
    done
fi

if id mimetite >/dev/null 2>&1; then
    status "Removing mimetite user..."
    $SUDO userdel mimetite
fi

if getent group mimetite >/dev/null 2>&1; then
    status "Removing mimetite group..."
    $SUDO groupdel mimetite
fi
