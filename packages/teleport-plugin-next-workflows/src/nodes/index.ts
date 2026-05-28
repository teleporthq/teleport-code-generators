import { NodeHandlerGenerator } from './types'
import { integrationRegistry } from './integrations'

import { accountComparePasswords } from './account/account-compare-passwords'
import { accountGetCurrent } from './account/account-get-current'
import { accountHashPassword } from './account/account-hash-password'
import { accountLogin } from './account/account-login'
import { accountLogout } from './account/account-logout'
import { accountSignup } from './account/account-signup'
import { accountSocialLogin } from './account/account-social-login'
import { audioPlay } from './audio/audio-play'
import { audioStop } from './audio/audio-stop'
import { aiCustomPrompt } from './ai/ai-custom-prompt'
import { aiDetectLanguage } from './ai/ai-detect-language'
import { aiGenerateTextEmbedding } from './ai/ai-generate-text-embedding'
import { aiSentimentAnalysis } from './ai/ai-sentiment-analysis'
import { aiSummarization } from './ai/ai-summarization'
import { aiTextClassifier } from './ai/ai-text-classifier'
import { aiTextTransform } from './ai/ai-text-transform'
import { browserAskPermission } from './browser/browser-ask-permission'
import { browserFullscreen } from './browser/browser-fullscreen'
import { browserGetDeviceInfo } from './browser/browser-get-device-info'
import { browserGetLocation } from './browser/browser-get-location'
import { browserGetMediaDevices } from './browser/browser-get-media-devices'
import { browserGetNetworkStatus } from './browser/browser-get-network-status'
import { browserPickFiles } from './browser/browser-pick-files'
import { browserPrint } from './browser/browser-print'
import { browserReadClipboard } from './browser/browser-read-clipboard'
import { browserShare } from './browser/browser-share'
import { browserShowNotification } from './browser/browser-show-notification'
import { browserSpeechToText } from './browser/browser-speech-to-text'
import { browserSubscribeToPush } from './browser/browser-subscribe-to-push'
import { browserTextToSpeech } from './browser/browser-text-to-speech'
import { browserWriteClipboard } from './browser/browser-write-clipboard'
import { cartAddItem } from './cart/cart-add-item'
import { cartClear } from './cart/cart-clear'
import { cartGetItems } from './cart/cart-get-items'
import { cartGetTotal } from './cart/cart-get-total'
import { cartRemoveItem } from './cart/cart-remove-item'
import { cartUpdateItemQuantity } from './cart/cart-update-item-quantity'
import { ecommerceGenerateInvoice } from './ecommerce/ecommerce-generate-invoice'
import { ecommerceGetSettings } from './ecommerce/ecommerce-get-settings'
import { fileStorageUpload } from './file-storage/file-storage-upload'
import { fileStorageList } from './file-storage/file-storage-list'
import { fileStorageGetDetails } from './file-storage/file-storage-get-details'
import { fileStorageDelete } from './file-storage/file-storage-delete'
import { eventWorkflowError } from './event/event-workflow-error'
import { dataCount } from './data/data-count'
import { dataCreateItem } from './data/data-create-item'
import { dataDeleteItem } from './data/data-delete-item'
import { dataRawQuery } from './data/data-raw-query'
import { dataSelect } from './data/data-select'
import { dataUpdateItem } from './data/data-update-item'
import { elementAddClass } from './element/element-add-class'
import { elementGetAttribute } from './element/element-get-attribute'
import { elementGetClasses } from './element/element-get-classes'
import { elementGetInputValue } from './element/element-get-input-value'
import { elementHide } from './element/element-hide'
import { elementRemoveClass } from './element/element-remove-class'
import { elementScrollTo } from './element/element-scroll-to'
import { elementSetAttribute } from './element/element-set-attribute'
import { elementSetText } from './element/element-set-text'
import { elementShow } from './element/element-show'
import { elementToggleClass } from './element/element-toggle-class'
import { emailMailersend } from './email/email-mailersend'
import { emailMailgun } from './email/email-mailgun'
import { emailPostmark } from './email/email-postmark'
import { emailResend } from './email/email-resend'
import { emailSendgrid } from './email/email-sendgrid'
import { formBlur } from './form/form-blur'
import { formFocus } from './form/form-focus'
import { formReset } from './form/form-reset'
import { formSetValue } from './form/form-set-value'
import { generalCustomJs } from './general/general-custom-js'
import { generalCustomNode } from './general/general-custom-node'
import { generalDelay } from './general/general-delay'
import { generalEmitCustomEvent } from './general/general-emit-custom-event'
import { generalExtractFormData } from './general/general-extract-form-data'
import { generalHttpRequest } from './general/general-http-request'
import { generalRateLimiter } from './general/general-rate-limiter'
import { generalIfStatement } from './general/general-if-statement'
import { generalLoop } from './general/general-loop'
import { generalParallel } from './general/general-parallel'
import { generalSwitch } from './general/general-switch'
import { generalTriggerDownload } from './general/general-trigger-download'
import { navigationGoBack } from './navigation/navigation-go-back'
import { navigationGoToPage } from './navigation/navigation-go-to-page'
import { navigationNavigateToUrl } from './navigation/navigation-navigate-to-url'
import { navigationRefreshPage } from './navigation/navigation-refresh-page'
import { paymentCancelPlan } from './payment/payment-cancel-plan'
import { paymentChargeUser } from './payment/payment-charge-user'
import { paymentCreateCustomer } from './payment/payment-create-customer'
import { paymentCreateProduct } from './payment/payment-create-product'
import { paymentCreateSubscription } from './payment/payment-create-subscription'
import { paymentGetCustomer } from './payment/payment-get-customer'
import { paymentGetProduct } from './payment/payment-get-product'
import { paymentListCustomers } from './payment/payment-list-customers'
import { paymentListPlans } from './payment/payment-list-plans'
import { paymentListProducts } from './payment/payment-list-products'
import { paymentListSubscriptions } from './payment/payment-list-subscriptions'
import { paymentSubscribeToPlan } from './payment/payment-subscribe-to-plan'
import { paymentUpdateCustomer } from './payment/payment-update-customer'
import { realtimeJoinChannel } from './realtime/realtime-join-channel'
import { realtimeLeaveChannel } from './realtime/realtime-leave-channel'
import { realtimeListChannelMembers } from './realtime/realtime-list-channel-members'
import { realtimeListChannels } from './realtime/realtime-list-channels'
import { realtimeSendChannelEvent } from './realtime/realtime-send-channel-event'
import { realtimeSendChannelMessage } from './realtime/realtime-send-channel-message'
import { smsInfobip } from './sms/sms-infobip'
import { smsSmsapi } from './sms/sms-smsapi'
import { smsTextmagic } from './sms/sms-textmagic'
import { smsTwilio } from './sms/sms-twilio'
import { stateBatchUpdate } from './state/state-batch-update'
import { stateGetGlobalState } from './state/state-get-global-state'
import { stateGetLocalState } from './state/state-get-local-state'
import { stateUpdateGlobalState } from './state/state-update-global-state'
import { stateUpdateLocalState } from './state/state-update-local-state'
import { storageLocalGet } from './storage/storage-local-get'
import { storageLocalRemove } from './storage/storage-local-remove'
import { storageLocalSet } from './storage/storage-local-set'
import { storageSessionGet } from './storage/storage-session-get'
import { storageSessionRemove } from './storage/storage-session-remove'
import { storageSessionSet } from './storage/storage-session-set'
import { toastShow } from './toast/toast-show'
import { transformArray } from './transform/transform-array'
import { transformCalculate } from './transform/transform-calculate'
import { transformColor } from './transform/transform-color'
import { transformConvert } from './transform/transform-convert'
import { transformCurrency } from './transform/transform-currency'
import { transformDateTime } from './transform/transform-date-time'
import { transformGenerate } from './transform/transform-generate'
import { transformGeolocation } from './transform/transform-geolocation'
import { transformImage } from './transform/transform-image'
import { transformMerge } from './transform/transform-merge'
import { transformObject } from './transform/transform-object'
import { transformString } from './transform/transform-string'
import { transformValidate } from './transform/transform-validate'
import { urlGetCurrentUrl } from './url/url-get-current-url'
import { urlGetQueryParameter } from './url/url-get-query-parameter'
import { utilityAnonymizeData } from './utility/utility-anonymize-data'
import { utilityBarcodeGenerate } from './utility/utility-barcode-generate'
import { utilityCsvParse } from './utility/utility-csv-parse'
import { utilityEncodeDecode } from './utility/utility-encode-decode'
import { utilityExtractContacts } from './utility/utility-extract-contacts'
import { utilityExtractLinks } from './utility/utility-extract-links'
import { utilityFormatPhoneNumber } from './utility/utility-format-phone-number'
import { utilityFullTextSearch } from './utility/utility-full-text-search'
import { utilityGenerateInvoicePdf } from './utility/utility-generate-invoice-pdf'
import { utilityHashData } from './utility/utility-hash-data'
import { utilityHybridSearch } from './utility/utility-hybrid-search'
import { utilityMarkdownToHtml } from './utility/utility-markdown-to-html'
import { utilityOcrExtractText } from './utility/utility-ocr-extract-text'
import { utilityParseUrl } from './utility/utility-parse-url'
import { utilityPdfExtractText } from './utility/utility-pdf-extract-text'
import { utilityPdfGenerate } from './utility/utility-pdf-generate'
import { utilityQrCodeGenerate } from './utility/utility-qr-code-generate'
import { utilityScrapeWebsite } from './utility/utility-scrape-website'
import { utilitySemanticSearch } from './utility/utility-semantic-search'
import { utilitySimilarityScoring } from './utility/utility-similarity-scoring'
import { utilityVerifyEmail } from './utility/utility-verify-email'
import { utilityVerifyPhone } from './utility/utility-verify-phone'
import { utilityXmlParse } from './utility/utility-xml-parse'
import { utilityYoutubeTranscript } from './utility/utility-youtube-transcript'

export const nodeRegistry: Record<string, NodeHandlerGenerator> = {
  'account-compare-passwords': accountComparePasswords,
  'account-get-current': accountGetCurrent,
  'account-hash-password': accountHashPassword,
  'account-login': accountLogin,
  'account-logout': accountLogout,
  'account-signup': accountSignup,
  'account-social-login': accountSocialLogin,
  'audio-play': audioPlay,
  'audio-stop': audioStop,
  'ai-custom-prompt': aiCustomPrompt,
  'ai-detect-language': aiDetectLanguage,
  'ai-generate-text-embedding': aiGenerateTextEmbedding,
  'ai-sentiment-analysis': aiSentimentAnalysis,
  'ai-summarization': aiSummarization,
  'ai-text-classifier': aiTextClassifier,
  'ai-text-transform': aiTextTransform,
  'browser-ask-permission': browserAskPermission,
  'browser-fullscreen': browserFullscreen,
  'browser-get-device-info': browserGetDeviceInfo,
  'browser-get-location': browserGetLocation,
  'browser-get-media-devices': browserGetMediaDevices,
  'browser-get-network-status': browserGetNetworkStatus,
  'browser-pick-files': browserPickFiles,
  'browser-print': browserPrint,
  'browser-read-clipboard': browserReadClipboard,
  'browser-share': browserShare,
  'browser-show-notification': browserShowNotification,
  'browser-speech-to-text': browserSpeechToText,
  'browser-subscribe-to-push': browserSubscribeToPush,
  'browser-text-to-speech': browserTextToSpeech,
  'browser-write-clipboard': browserWriteClipboard,
  'cart-add-item': cartAddItem,
  'cart-clear': cartClear,
  'cart-get-items': cartGetItems,
  'cart-get-total': cartGetTotal,
  'cart-remove-item': cartRemoveItem,
  'cart-update-item-quantity': cartUpdateItemQuantity,
  'ecommerce-generate-invoice': ecommerceGenerateInvoice,
  'ecommerce-get-settings': ecommerceGetSettings,
  'file-storage-upload': fileStorageUpload,
  'file-storage-list': fileStorageList,
  'file-storage-get-details': fileStorageGetDetails,
  'file-storage-delete': fileStorageDelete,
  'event-workflow-error': eventWorkflowError,
  'data-count': dataCount,
  'data-create-item': dataCreateItem,
  'data-delete-item': dataDeleteItem,
  'data-raw-query': dataRawQuery,
  'data-select': dataSelect,
  'data-update-item': dataUpdateItem,
  'element-add-class': elementAddClass,
  'element-get-attribute': elementGetAttribute,
  'element-get-classes': elementGetClasses,
  'element-get-input-value': elementGetInputValue,
  'element-hide': elementHide,
  'element-remove-class': elementRemoveClass,
  'element-scroll-to': elementScrollTo,
  'element-set-attribute': elementSetAttribute,
  'element-set-text': elementSetText,
  'element-show': elementShow,
  'element-toggle-class': elementToggleClass,
  'email-mailersend': emailMailersend,
  'email-mailgun': emailMailgun,
  'email-postmark': emailPostmark,
  'email-resend': emailResend,
  'email-sendgrid': emailSendgrid,
  'form-blur': formBlur,
  'form-focus': formFocus,
  'form-reset': formReset,
  'form-set-value': formSetValue,
  'general-custom-js': generalCustomJs,
  'general-custom-node': generalCustomNode,
  'general-delay': generalDelay,
  'general-emit-custom-event': generalEmitCustomEvent,
  'general-extract-form-data': generalExtractFormData,
  'general-http-request': generalHttpRequest,
  'general-if-statement': generalIfStatement,
  'general-rate-limiter': generalRateLimiter,
  'general-loop': generalLoop,
  'general-parallel': generalParallel,
  'general-switch': generalSwitch,
  'general-trigger-download': generalTriggerDownload,
  'navigation-go-back': navigationGoBack,
  'navigation-go-to-page': navigationGoToPage,
  'navigation-navigate-to-url': navigationNavigateToUrl,
  'navigation-refresh-page': navigationRefreshPage,
  'payment-cancel-plan': paymentCancelPlan,
  'payment-charge-user': paymentChargeUser,
  'payment-create-customer': paymentCreateCustomer,
  'payment-create-product': paymentCreateProduct,
  'payment-create-subscription': paymentCreateSubscription,
  'payment-get-customer': paymentGetCustomer,
  'payment-get-product': paymentGetProduct,
  'payment-list-customers': paymentListCustomers,
  'payment-list-plans': paymentListPlans,
  'payment-list-products': paymentListProducts,
  'payment-list-subscriptions': paymentListSubscriptions,
  'payment-subscribe-to-plan': paymentSubscribeToPlan,
  'payment-update-customer': paymentUpdateCustomer,
  'realtime-join-channel': realtimeJoinChannel,
  'realtime-leave-channel': realtimeLeaveChannel,
  'realtime-list-channel-members': realtimeListChannelMembers,
  'realtime-list-channels': realtimeListChannels,
  'realtime-send-channel-event': realtimeSendChannelEvent,
  'realtime-send-channel-message': realtimeSendChannelMessage,
  'sms-infobip': smsInfobip,
  'sms-smsapi': smsSmsapi,
  'sms-textmagic': smsTextmagic,
  'sms-twilio': smsTwilio,
  'state-batch-update': stateBatchUpdate,
  'state-get-global-state': stateGetGlobalState,
  'state-get-local-state': stateGetLocalState,
  'state-update-global-state': stateUpdateGlobalState,
  'state-update-local-state': stateUpdateLocalState,
  'storage-local-get': storageLocalGet,
  'storage-local-remove': storageLocalRemove,
  'storage-local-set': storageLocalSet,
  'storage-session-get': storageSessionGet,
  'storage-session-remove': storageSessionRemove,
  'storage-session-set': storageSessionSet,
  'toast-show': toastShow,
  'transform-array': transformArray,
  'transform-calculate': transformCalculate,
  'transform-color': transformColor,
  'transform-convert': transformConvert,
  'transform-currency': transformCurrency,
  'transform-date-time': transformDateTime,
  'transform-generate': transformGenerate,
  'transform-geolocation': transformGeolocation,
  'transform-image': transformImage,
  'transform-merge': transformMerge,
  'transform-object': transformObject,
  'transform-string': transformString,
  'transform-validate': transformValidate,
  'url-get-current-url': urlGetCurrentUrl,
  'url-get-query-parameter': urlGetQueryParameter,
  'utility-anonymize-data': utilityAnonymizeData,
  'utility-barcode-generate': utilityBarcodeGenerate,
  'utility-csv-parse': utilityCsvParse,
  'utility-encode-decode': utilityEncodeDecode,
  'utility-extract-contacts': utilityExtractContacts,
  'utility-extract-links': utilityExtractLinks,
  'utility-format-phone-number': utilityFormatPhoneNumber,
  'utility-full-text-search': utilityFullTextSearch,
  'utility-generate-invoice-pdf': utilityGenerateInvoicePdf,
  'utility-hash-data': utilityHashData,
  'utility-hybrid-search': utilityHybridSearch,
  'utility-markdown-to-html': utilityMarkdownToHtml,
  'utility-ocr-extract-text': utilityOcrExtractText,
  'utility-parse-url': utilityParseUrl,
  'utility-pdf-extract-text': utilityPdfExtractText,
  'utility-pdf-generate': utilityPdfGenerate,
  'utility-qr-code-generate': utilityQrCodeGenerate,
  'utility-scrape-website': utilityScrapeWebsite,
  'utility-semantic-search': utilitySemanticSearch,
  'utility-similarity-scoring': utilitySimilarityScoring,
  'utility-verify-email': utilityVerifyEmail,
  'utility-verify-phone': utilityVerifyPhone,
  'utility-xml-parse': utilityXmlParse,
  'utility-youtube-transcript': utilityYoutubeTranscript,
  ...integrationRegistry,
}
