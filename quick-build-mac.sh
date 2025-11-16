#!/bin/bash

# Quick build script for Mac - minimal version
cd "$(dirname "$0")"
pnpm install && pnpm build:mac
