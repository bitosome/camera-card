# Changelog

## 1.7.0 — 2026-11-03

- Bundles `@bitosome/ha-card-ui` 1.4.0 and uses its shared status colours,
  pending indicator and Home Assistant number formatting.
- PTZ presets show a pending indicator while the move is requested and announce
  it as busy. The selected preset is exposed as pressed and gets a ring, so it is
  no longer shown by colour alone.
- Hover styling only applies on devices that can hover and uses a darker scrim
  instead of the "on" fill, so a toggle switched off by tapping no longer looks on.
  The focus ring stays visible on active buttons.
- Fullscreen controls read Home Assistant's safe-area insets as well as the
  browser's. Navigation arrows, the zoom indicator, the mobile control and preset
  rows and the recording player now also keep clear of side and bottom insets.
- Recording playback failures are announced as alerts. Error, warning and live
  colours follow the theme through the shared status colours instead of private
  fallbacks.
- The zoom indicator formats its scale with the Home Assistant number format,
  for example `2,0×` in German.
- The visual editor's move and remove buttons have 44px touch targets and use
  the shared drag icon.
