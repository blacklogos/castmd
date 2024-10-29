# Development Journal

## Current Status
- Intelligent content detection implemented
- Multiple theme options available
- URL analysis with outline extraction working
- Improved clipboard integration
- Better error handling
- Added support for code blocks and tables

## Known Issues
1. Some dynamic content might not be captured
2. Complex nested lists need improvement
3. Some websites block content extraction
4. Edge cases in heading hierarchy
5. Code block language detection needs improvement
6. Complex tables might not render correctly

## Planned Features

### High Priority
- [x] Support for code blocks with language detection
- [x] Support for tables with alignment
- [ ] Handle dynamic content loading
- [ ] Add progress indicator for large pages

### Medium Priority
- [ ] Support for nested lists
- [ ] Implement custom conversion rules
- [ ] Add options page for customization
- [ ] Support for inline formatting (bold, italic)

### Low Priority
- [ ] Add export options (file download)
- [ ] Support for images
- [ ] Add more theme options
- [ ] Conversion history

## Version History

### v1.5 (Current)
- Added support for code blocks with syntax highlighting
- Added support for markdown tables
- Improved content detection for technical content
- Better handling of pre-formatted text
- Added table alignment support
- Fixed code block indentation issues

### v1.4
- Added intelligent content detection
- Implemented multiple theme options
- Improved URL analysis
- Added Copy Page Outline feature
- Fixed outline extraction issues
- Added new tab indicator for outline tool

### v1.3
- Added URL analysis feature
- Implemented retry mechanism
- Improved error handling
- Added status messages

### v1.2
- Added outline extraction tool
- Improved clipboard integration
- Fixed timing issues

### v1.1
- Basic Markdown conversion
- Popup interface
- Content script implementation

### v1.0
- Initial release
- Basic HTML parsing
- Simple conversion rules

## Notes for Future Development
- Consider implementing a worker for large page processing
- Look into using a Markdown parsing library
- Need to add unit tests
- Consider adding conversion templates
- Improve content detection algorithm
- Add support for more complex HTML structures

## Recent Improvements
1. Better heading hierarchy management
2. Smarter content area detection
3. Theme system with persistence
4. Improved user feedback
5. Better error handling
6. More reliable clipboard operations
7. Code block syntax highlighting
8. Table formatting and alignment

## Code Block Support
Now supports various code block formats:
- Fenced code blocks with language specification
- Inline code blocks
- Indented code blocks
- Language detection for common programming languages
- Proper escaping of special characters

## Table Support
Added support for:
- Basic tables with headers
- Column alignment (left, center, right)
- Complex tables with merged cells
- Table captions
- Proper cell padding and formatting

## Technical Implementation Notes
### Code Blocks
```javascript
//
</rewritten_file>