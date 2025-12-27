# Changelog

All notable changes to the Discord Level Bot will be documented in this file.

## [3.1.0] - 2025-12-27

### Added
- JSDoc comments for all utility functions
- Proper permission validation using PermissionsBitField
- Enhanced error handling throughout the code
- Improved README with detailed documentation
- Package.json with proper metadata and scripts
- .env.example file for configuration
- Changelog file to track updates
- Improved database schema with proper defaults

### Changed
- Updated Discord.js to use PermissionsBitField.Flags.Administrator instead of string-based permissions
- Improved code structure with better organization
- Enhanced profile image generation with better error handling
- Updated bot version to 3.1.0 in info command
- Made SAFE_CHANNEL_ID configurable via environment variable
- Improved command handling with better error catching

### Fixed
- Fixed potential SQL injection vulnerabilities by using prepared statements consistently
- Fixed role creation error handling in updateRankRole function
- Fixed image validation in setbg command
- Fixed temporary message deletion logic
- Fixed level up announcement channel selection

### Security
- Improved validation for image URLs
- Better error handling to prevent crashes
- Enhanced input validation for commands

## [3.0.0] - Previous Release

### Added
- Level system with XP progression
- Rank-based roles
- Achievement system
- Profile images with custom backgrounds
- Daily XP rewards
- Reputation system
- XP transfer between users
- Premium shop with purchasable backgrounds
- Level-up reminders
- User comparison tool
- Leaderboard with pagination
- Admin commands for XP management