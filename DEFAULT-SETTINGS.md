# BetterStash default settings

Edit the value after each `=` and send the file back. Booleans: true / false.
Lines starting with `#` are notes. Empty values are fine.

## Connection
# Normally set per user in the popup. Example shown in the field: https://stash.example.com
sitePattern =

## Identity and team
# Your display name, exactly as on reviewer avatars. Field placeholder: e.g. Kowalski Jan
identity =
# Team members, comma-separated. Field placeholder: e.g. Młynarski, Cieślak
team =
# Subtle blue row tint
teamTint = true
# Small team badge after author name
teamIcon = false
# Pin team PRs to top of "to review"
pinTeam = true

## Auto-expand "Show more pull requests"
expandReview = true
expandYours = false
expandClosed = false

## Sections (dashboard)
tierBlocked = true
tierApproved = true
tierWip = true
# Dim rows in Approved / WIP
dimRows = true

## Diff view
# Compact floating PR header card
prBar = true
# Where the card shows: diff (Diff tab only) or all (every PR tab)
prBarScope = diff
# Idle opacity of card and copy button, 20-100
prBarOpacity = 100
# Fit image diffs to screen height (also zoom buttons + sticky mode switcher)
imageFit = true
# "Copy to prompt" button
copyPrButton = true
# Placeholders: {url} {branch} {target} {repo} {project} {id} {title}
copyPrTemplate = review this {branch}

## Dashboard layout
zenMode = true

## Hard-coded today (tell me new values and I'll change the code)
zoomLevels = 1x, 2x, 3x
cardMaxWidth = 640px
cardOffsetFromRightAndBottom = 16px
actionButtonHeight = 30px
copiedFeedbackSeconds = 1.5
