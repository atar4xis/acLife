#!/bin/bash

go build -ldflags="-w -s -buildid=" -trimpath -o bin/acLife