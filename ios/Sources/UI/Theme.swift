import SwiftUI

extension Color {
    /// `#RRGGBB` or `#RRGGBBAA`.
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}

/// Same palette as `public/css/main.css`'s `:root` tokens — wesaid is a
/// dark-first app by design (`app: { theme: 'dark', ... }` is the default in
/// `settings.js`, with light mode as an opt-in the user has to switch to),
/// so this is the app's actual identity, not just "whatever the system
/// prefers." An appearance toggle is a later phase; there is no settings
/// screen yet to hang one off of.
enum WesaidTheme {
    static let background  = Color(hex: 0x06060b)   // --bg
    static let background2 = Color(hex: 0x0b0b14)   // --bg2
    static let surface     = Color(hex: 0x14142a)   // --surf
    static let surface2    = Color(hex: 0x1a1a36)   // --surf2

    /// `hsl(28, 90%, 58%)`, the CSS default accent — orange, matching the
    /// `#f97316` fallback `settings.js` itself uses for `accentColor`.
    static let accent = Color(hex: 0xf97316)
    static let accentGlow = Color(hex: 0xf97316, alpha: 0.30)

    static let text1 = Color(hex: 0xfff5eb)   // --t1, primary
    static let text2 = Color(hex: 0xc8b8a4)   // --t2, secondary
    static let text3 = Color(hex: 0x7a6e5e)   // --t3, tertiary/hints

    // --r-* corner radii.
    static let radiusXS: CGFloat = 8
    static let radiusSM: CGFloat = 12
    static let radius: CGFloat = 18
    static let radiusLG: CGFloat = 24
    static let radiusXL: CGFloat = 32
}

extension Font {
    /// The wordmark and section headings use the rounded system design
    /// throughout, echoing the softer, friendlier feel of the web version's
    /// custom display type.
    static func wesaidRounded(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }
}

/// The asymmetric "tail" shape from `.msg-bubble` — sharp on the corner
/// nearest the avatar, rounded everywhere else. `UnevenRoundedRectangle`
/// mirrors CSS's `border-radius: 4px 18px 18px 18px` shorthand exactly.
enum MessageBubbleShape {
    static func bot() -> UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: 4, bottomLeadingRadius: WesaidTheme.radius,
            bottomTrailingRadius: WesaidTheme.radius, topTrailingRadius: WesaidTheme.radius
        )
    }

    static func user() -> UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: WesaidTheme.radius, bottomLeadingRadius: WesaidTheme.radius,
            bottomTrailingRadius: WesaidTheme.radius, topTrailingRadius: 4
        )
    }
}
