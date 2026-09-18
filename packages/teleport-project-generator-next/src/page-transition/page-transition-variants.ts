import { PageTransition } from '@teleporthq/teleport-shared'

/* The registry lives in teleport-shared, where the HTML export reads it too. */
export type PageTransitionContext = PageTransition.PageTransitionContext
export type PageTransitionPanel = PageTransition.PageTransitionPanel
export type PageTransitionVariants = PageTransition.PageTransitionVariants
export type PageTransitionCustomState = PageTransition.PageTransitionCustomState
export type PageTransitionCustom = PageTransition.PageTransitionCustom

export const reversePageTransitionPreset = PageTransition.reversePageTransitionPreset
export const pageTransitionVariants = PageTransition.pageTransitionVariants
export const pageTransitionCover = PageTransition.pageTransitionCover
export const pageTransitionSkipPattern = PageTransition.pageTransitionSkipPattern
export const PAGE_TRANSITION_SLIDE_PX = PageTransition.PAGE_TRANSITION_SLIDE_PX
export const resolvePageTransitionOptions = PageTransition.resolvePageTransitionOptions
export const isPageTransitionColorValue = PageTransition.isPageTransitionColorValue
export const pageTransitionCoverColor = PageTransition.pageTransitionCoverColor
export const sanitizePageTransitionCustom = PageTransition.sanitizePageTransitionCustom
