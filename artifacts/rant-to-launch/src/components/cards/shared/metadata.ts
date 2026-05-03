import { AssetCardKind } from "@workspace/api-client-react";
import {
  CalendarDays,
  Film,
  Images,
  LayoutPanelTop,
  Linkedin,
  Mail,
  Rocket,
  Twitter,
  type LucideIcon,
} from "lucide-react";

export interface SectionMeta {
  kind: AssetCardKind;
  title: string;
  shortTitle: string;
  anchorId: string;
  icon: LucideIcon;
}

export const SECTION_META: Record<AssetCardKind, SectionMeta> = {
  [AssetCardKind.launch_angle]: {
    kind: AssetCardKind.launch_angle,
    title: "Launch angle",
    shortTitle: "Angle",
    anchorId: "section-launch-angle",
    icon: Rocket,
  },
  [AssetCardKind.landing_page_copy]: {
    kind: AssetCardKind.landing_page_copy,
    title: "Landing page",
    shortTitle: "Landing",
    anchorId: "section-landing-page",
    icon: LayoutPanelTop,
  },
  [AssetCardKind.x_thread]: {
    kind: AssetCardKind.x_thread,
    title: "X thread",
    shortTitle: "X thread",
    anchorId: "section-x-thread",
    icon: Twitter,
  },
  [AssetCardKind.linkedin_post]: {
    kind: AssetCardKind.linkedin_post,
    title: "LinkedIn post",
    shortTitle: "LinkedIn",
    anchorId: "section-linkedin",
    icon: Linkedin,
  },
  [AssetCardKind.newsletter_blurb]: {
    kind: AssetCardKind.newsletter_blurb,
    title: "Newsletter blurb",
    shortTitle: "Newsletter",
    anchorId: "section-newsletter",
    icon: Mail,
  },
  [AssetCardKind.carousel_outline]: {
    kind: AssetCardKind.carousel_outline,
    title: "Carousel outline",
    shortTitle: "Carousel",
    anchorId: "section-carousel",
    icon: Images,
  },
  [AssetCardKind.storyboard_cards]: {
    kind: AssetCardKind.storyboard_cards,
    title: "Storyboard",
    shortTitle: "Storyboard",
    anchorId: "section-storyboard",
    icon: Film,
  },
  [AssetCardKind.posting_schedule]: {
    kind: AssetCardKind.posting_schedule,
    title: "Launch-day posting plan",
    shortTitle: "Schedule",
    anchorId: "section-schedule",
    icon: CalendarDays,
  },
};

export const SECTION_ORDER: readonly AssetCardKind[] = [
  AssetCardKind.launch_angle,
  AssetCardKind.landing_page_copy,
  AssetCardKind.x_thread,
  AssetCardKind.linkedin_post,
  AssetCardKind.newsletter_blurb,
  AssetCardKind.carousel_outline,
  AssetCardKind.storyboard_cards,
  AssetCardKind.posting_schedule,
];

export const SOURCE_RANT_ANCHOR = "section-source-rant";
