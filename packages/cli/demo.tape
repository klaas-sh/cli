# VHS Demo Tape for klaas CLI
# Install VHS: brew install charmbracelet/tap/vhs
# Run: vhs demo.tape
#
# This creates a demo.gif showing klaas in action

# Configuration
Output demo.gif
Set FontSize 14
Set Width 800
Set Height 500
Set Theme "Dracula"
Set Padding 20
Set TypingSpeed 50ms

# Start with a clean terminal
Hide
Type "clear"
Enter
Show

# Show the klaas banner/help
Sleep 500ms
Type "klaas --help"
Sleep 100ms
Enter
Sleep 2s

# Clear and show version
Type "clear"
Enter
Sleep 500ms
Type "klaas --version"
Enter
Sleep 1.5s

# Clear and demonstrate starting klaas
Type "clear"
Enter
Sleep 500ms

# Type the command
Type "# Start Claude Code with remote access"
Enter
Sleep 500ms
Type "klaas"
Sleep 1s

# Note: The actual klaas command would start an interactive session
# For the demo, we'll just show the command being typed
# In a real recording, you'd capture the actual auth flow

Sleep 2s

# Show update command
Type@50ms "clear"
Enter
Sleep 500ms
Type "# Self-update to latest version"
Enter
Sleep 500ms
Type "klaas update"
Sleep 2s
