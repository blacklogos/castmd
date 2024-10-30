# Web Toolkit Chrome Extension

A sleek, modern Chrome extension for web content manipulation. Convert HTML to Markdown, extract page outlines, and analyze URLs with a beautiful dark-themed interface.

## Introduction

This extension provides essential web content tools with an intelligent content detection system. Perfect for developers, content creators, and anyone who needs to quickly convert web content to Markdown format.

## Features

- 🔄 **Intelligent Content Detection**: Automatically excludes navigation, footers, and irrelevant content
- 📝 **Smart Markdown Conversion**: Converts webpage content while maintaining proper heading hierarchy
- 📑 **Multiple Outline Options**: Extract outlines from current page or analyze any URL
- 🎨 **Theme Options**: 
  - Dracula (Default)
  - Cursor AI-inspired
  - Vampire (Easter Egg)
- 🔍 **URL Analysis**: Analyze any webpage's content structure
- 📋 **Quick Copy Actions**: One-click copy for both full content and outlines
- 🌐 **Standalone Tools**: Dedicated outline extraction tool for markdown content

## Installation

1. Clone this repository or download the source code
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory

## Usage

### Converting Pages
1. Click the extension icon
2. Click "Copy Page to Markdown"
3. Content is automatically copied to clipboard with proper formatting

### Working with Outlines
1. **Current Page**: Click "Copy Page Outline" to get the current page structure
2. **From Markdown**: Use "Extract Outline from MD" to process existing markdown
3. **From URL**: Enter URL and use "Analyze URL" to extract content and outline

### URL Analysis
1. Enter any webpage URL
2. Click "Analyze URL"
3. View the extracted outline
4. Choose to copy either the full markdown or just the outline

## Technical Details

- Built with Chrome Extension Manifest V3
- Intelligent content detection algorithm
- Smart heading hierarchy management
- Multiple theme support with persistent settings
- Async/await pattern for better performance
- Error handling and retry mechanisms

## Features Deep Dive

### File Naming System
- Uses URL slug for more consistent file names
- Fallbacks to hostname if slug is unavailable
- Handles non-English URLs gracefully
- Limits filename length to 35 characters
- Removes common file extensions (.html, .php, etc.)

### Content Detection
- Identifies main content areas using semantic HTML
- Excludes navigation, footers, and sidebars
- Uses content density analysis as fallback
- Maintains proper heading hierarchy

### Theme System
- Default Dracula theme for dark mode lovers
- Cursor AI-inspired theme for a modern look
- Vampire theme for fun.
- Persistent theme preferences

## Development

Active project with regular updates. See JOURNAL.md for development progress and planned features.

## Changelog
v0.6.0 (Beta)
- Improved file naming system using URL slugs
- Better handling of international characters
- Added debug logging with vampire emoji
- Fixed filename length issues
- Added fallback to hostname for numeric slugs

## Development Status
Currently in beta. Targeting v1.0.0 release with:
- Complete test coverage
- Full documentation
- Stable API (I don't know about this part.)
- Production-ready features

## Credits

Crafted with 🧛‍♀️ by [Tri Vo](https://mtri.me)
