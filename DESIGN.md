---
name: Sanad Core
colors:
  surface: '#f8f9ff'
  surface-dim: '#d0dbed'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e6eeff'
  surface-container-high: '#dee9fc'
  surface-container-highest: '#d9e3f6'
  on-surface: '#121c2a'
  on-surface-variant: '#3f4944'
  inverse-surface: '#27313f'
  inverse-on-surface: '#eaf1ff'
  outline: '#6f7973'
  outline-variant: '#bec9c2'
  surface-tint: '#1b6b51'
  primary: '#004532'
  on-primary: '#ffffff'
  primary-container: '#065f46'
  on-primary-container: '#8bd6b7'
  inverse-primary: '#8bd6b6'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#003980'
  on-tertiary: '#ffffff'
  tertiary-container: '#004fac'
  on-tertiary-container: '#aec7ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#a6f2d1'
  primary-fixed-dim: '#8bd6b6'
  on-primary-fixed: '#002116'
  on-primary-fixed-variant: '#00513b'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#d8e2ff'
  tertiary-fixed-dim: '#adc6ff'
  on-tertiary-fixed: '#001a42'
  on-tertiary-fixed-variant: '#004395'
  background: '#f8f9ff'
  on-background: '#121c2a'
  surface-variant: '#d9e3f6'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  sidebar-width: 260px
  container-max: 1440px
  gutter: 20px
---

## Brand & Style
The design system is anchored in the concept of "Sanad" (Support/Prop). It balances the rigor of a financial SaaS platform with the empathy required for humanitarian work. The aesthetic is **Corporate Modern** with a lean towards **Minimalism**, prioritizing high information density and absolute clarity.

The visual narrative focuses on "Traceability." Every element should feel grounded and secure. By utilizing ample white space, a structured grid, and a restricted palette, the interface reduces cognitive load for administrators managing complex beneficiary data. The emotional response is one of calm efficiency and institutional trust.

## Colors
The palette is dominated by **Deep Teal (#065f46)**, representing stability and growth. This is used for primary actions, active navigation states, and branding elements. 

The background uses a slightly off-white **Neutral Gray (#f9fafb)** to reduce screen glare during long sessions, while cards and interactive surfaces use pure white. Status colors follow global semantic standards but are slightly desaturated to maintain the professional tone. Text is rendered in **Dark Charcoal (#1f2937)** to ensure AA/AAA accessibility compliance against white surfaces.

## Typography
This design system utilizes a dual-font strategy optimized for bi-directional (RTL/LTR) interfaces. **Inter** is the primary typeface for English, chosen for its exceptional legibility in data-heavy SaaS environments. For Arabic contexts, **IBM Plex Sans Arabic** should be used, as its structured, modern letterforms align perfectly with Inter’s geometric nature.

**Hierarchy Rules:**
- Use `display-lg` for dashboard overviews and page headers.
- Use `label-caps` for table headers and small metadata tags.
- Line heights are generous (1.5x for body) to ensure readability in dense forms.
- For RTL, font-weight should be monitored closely; IBM Plex Sans Arabic may require a +100 weight increase to match the visual "heaviness" of Inter.

## Layout & Spacing
The layout follows a **Fixed Grid** model for the main content area, paired with a persistent left-aligned sidebar.

- **Sidebar:** 260px fixed width. In RTL mode, this mirrors to the right.
- **Main Canvas:** Uses a 12-column grid with 20px gutters. 
- **Margins:** 32px padding on all sides of the main content container for desktop, reducing to 16px on mobile.
- **Density:** Elements use an 8px spacing system. For high-density data tables, vertical cell padding can be reduced to 12px (3 units).

## Elevation & Depth
Depth is communicated through **Tonal Layering** and **Ambient Shadows**. The design system avoids heavy shadows to maintain a "flat" professional feel.

- **Level 0 (Canvas):** #f9fafb. No shadow.
- **Level 1 (Cards/Tables):** White background with a 1px border (#E5E7EB) and a very soft blur: `0px 1px 3px rgba(0,0,0,0.1)`.
- **Level 2 (Dropdowns/Modals):** White background with a more pronounced shadow to indicate focus: `0px 10px 15px -3px rgba(0,0,0,0.1)`.
- **Interactive States:** Buttons use a subtle inner-glow on hover to simulate "pressing" without using skeuomorphic gradients.

## Shapes
The shape language is **Soft** and disciplined. A standard radius of 0.25rem (4px) is applied to small components like checkboxes and inputs. Larger containers like cards and modals use 0.5rem (8px). 

This sharp-but-soft approach reinforces the "Professional/Efficient" personality, avoiding the playfulness of fully rounded "Pill" shapes while staying more approachable than pure "Sharp" 0px corners.

## Components
Consistent component behavior is critical for the "Sanad" platform's traceability.

- **Buttons:** Primary buttons are solid Deep Teal with white text. Secondary buttons use a subtle gray border. All buttons have a height of 40px for standard actions.
- **Input Fields:** Large labels placed above the field. Focus state uses a 2px Deep Teal ring. 
- **Tables:** The heart of the platform. Use "Zebra-striping" (alternating #f9fafb rows) only for tables exceeding 20 rows. Use sticky headers for long lists.
- **Status Badges:** Use a "Light Fill" style—the background is a 10% opacity version of the status color (e.g., Soft Green), and the text is the 100% color.
- **Timelines:** Used for beneficiary history. A vertical 2px gray line connects circular nodes. Completed steps are Deep Teal; pending steps are Light Gray.
- **Navigation:** Sidebar links use a 4px left-border (right-border in RTL) "indicator" to show the active page. Icons are 20px, stroke-based (not solid) to maintain a light visual weight.