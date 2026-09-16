/**
 * Firestore mail queue (Trigger Email Extension format) + optional EmailJS fallback.
 */
import { db } from './firebase-config.js';
import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  fetchCheckoutConfig,
  isEmailJsConfigured,
  getEmailDeliveryWarning,
} from './checkout-config.js';

var emailDeliveryWarningShown = false;

function normalizeRecipients(value) {
  if (Array.isArray(value)) {
    return value.map(function (e) {
      return String(e || '').trim();
    }).filter(function (e) {
      return e.indexOf('@') !== -1;
    });
  }
  var single = String(value || '').trim();
  return single.indexOf('@') !== -1 ? [single] : [];
}

export function buildTriggerEmailPayload(to, subject, html) {
  return {
    to: normalizeRecipients(to),
    message: {
      subject: String(subject || '').trim(),
      html: String(html || '').trim(),
    },
  };
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraphHtml(text) {
  return '<p style="font-family:Tahoma,Arial,sans-serif;line-height:1.7;color:#1e293b;">' +
    escapeHtml(text).replace(/\n/g, '<br>') +
    '</p>';
}

export function buildOrderAdminAlertHtml(orderId, payload) {
  var methodLabel = payload.paymentMethod === 'zaincash' ? 'زين كاش' : 'ماستر كارد / كي كارد';
  return (
    '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;">' +
    '<h2 style="color:#0ea5e9;">طلب دفع جديد بانتظار المراجعة</h2>' +
    paragraphHtml(
      'رقم الطلب: ' + orderId +
        '\nالمنتج: ' + (payload.productTitle || '') +
        '\nالمبلغ: ' + (payload.amountLabel || payload.amount) +
        '\nطريقة الدفع: ' + methodLabel +
        '\nالطالب: ' + (payload.userName || '') + ' <' + (payload.userEmail || '') + '>' +
        '\nراجع الوصل من لوحة الإدارة → طلبات الشراء.'
    ) +
    '</div>'
  );
}

export function buildStudentStatusHtml(status, order, customMessage) {
  var approved = status === 'approved';
  var title = approved ? 'تم قبول طلبك' : 'تم رفض طلبك';
  var intro = approved
    ? 'تم تفعيل وصولك للمحتوى المرتبط بطلبك. يمكنك الآن متابعة التعلم من المنصة.'
    : 'نعتذر، لم يتم قبول طلب الدفع الحالي. يمكنك مراجعة الوصل وإعادة المحاولة.';
  var note = customMessage ? '\n\nملاحظة من الإدارة:\n' + customMessage : '';
  return (
    '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;">' +
    '<h2 style="color:' + (approved ? '#16a34a' : '#dc2626') + ';">' + escapeHtml(title) + '</h2>' +
    paragraphHtml(
      'المنتج: ' + (order.productTitle || '') +
        '\nالمبلغ: ' + (order.amountLabel || order.amount || '') +
        '\n\n' + intro + note
    ) +
    '<p><a href="https://iraqi-fiber-academy.web.app/index.html#courses" style="color:#0ea5e9;">الذهاب إلى الكورسات</a></p>' +
    '</div>'
  );
}

function notifyEmailDeliveryUnconfigured(message) {
  if (!message) return;
  console.warn('[MailNotifications] ' + message);
  try {
    window.dispatchEvent(
      new CustomEvent('ifa:mail-delivery-unconfigured', {
        detail: { message: message },
      })
    );
    document.dispatchEvent(
      new CustomEvent('ifa:mail-delivery-unconfigured', {
        detail: { message: message },
      })
    );
  } catch (err) {
    /* ignore */
  }
}

function buildEmailJsTemplateParams(recipient, subject, html) {
  return {
    to_email: String(recipient || '').trim(),
    subject: String(subject || '').trim(),
    message_html: String(html || '').trim(),
    reply_to: String(recipient || '').trim(),
  };
}

export async function tryEmailJsDispatch(to, subject, html, config) {
  var resolvedConfig = config || (await fetchCheckoutConfig());
  var publicKey = String(resolvedConfig.emailjsPublicKey || '').trim();
  var serviceId = String(resolvedConfig.emailjsServiceId || '').trim();
  var templateId = String(resolvedConfig.emailjsTemplateId || '').trim();

  if (!isEmailJsConfigured(resolvedConfig)) {
    var unconfiguredMsg = getEmailDeliveryWarning(resolvedConfig);
    console.error('[MailNotifications] EmailJS not configured:', unconfiguredMsg);
    notifyEmailDeliveryUnconfigured(unconfiguredMsg);
    return false;
  }

  var recipient = normalizeRecipients(to)[0];
  if (!recipient) {
    console.error('[MailNotifications] EmailJS skipped — no valid recipient for:', to);
    return false;
  }

  var templateParams = buildEmailJsTemplateParams(recipient, subject, html);

  try {
    var response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lib_version: '3.2.0',
        user_id: publicKey,
        service_id: serviceId,
        template_id: templateId,
        template_params: templateParams,
      }),
    });
    if (!response.ok) {
      var responseText = await response.text();
      console.error(
        '[MailNotifications] EmailJS API error — HTTP ' +
          response.status +
          ' ' +
          response.statusText +
          '\nResponse body: ' +
          responseText +
          '\nTemplate params: ' +
          JSON.stringify(templateParams)
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error('[MailNotifications] EmailJS dispatch exception:', err);
    return false;
  }
}

/**
 * Queue email for Firebase Trigger Email + optional EmailJS fallback.
 */
export async function queueMailNotification(notificationId, to, subject, html, meta) {
  var recipients = normalizeRecipients(to);
  if (!recipients.length) {
    console.warn('[MailNotifications] skipped — no valid recipient');
    return false;
  }

  var triggerPayload = buildTriggerEmailPayload(recipients, subject, html);
  var docPayload = Object.assign(
    {
      type: (meta && meta.type) || 'generic',
      status: 'pending',
      orderId: (meta && meta.orderId) || '',
      userId: (meta && meta.userId) || '',
      createdAt: serverTimestamp(),
    },
    triggerPayload,
    meta && meta.extra ? meta.extra : {}
  );

  await setDoc(doc(db, 'mail_notifications', notificationId), docPayload, { merge: true });

  var config = await fetchCheckoutConfig();
  var sent = await tryEmailJsDispatch(recipients, subject, html, config);
  if (!sent) {
    var warning = getEmailDeliveryWarning(config);
    var deliveryMsg =
      (warning || 'EmailJS dispatch failed.') +
      ' Message queued in mail_notifications (' +
      notificationId +
      ') pending server/extension delivery.';
    console.error('[MailNotifications] Delivery failed:', deliveryMsg);
    if (!emailDeliveryWarningShown) {
      emailDeliveryWarningShown = true;
      notifyEmailDeliveryUnconfigured(deliveryMsg);
    }
  }
  return { queued: true, sent: sent, notificationId: notificationId };
}

export async function notifyAdminNewOrder(orderId, orderPayload, adminEmail) {
  var subject =
    '[طلب دفع جديد] ' + (orderPayload.productTitle || 'طلب') + ' — ' + (orderPayload.amountLabel || '');
  var html = buildOrderAdminAlertHtml(orderId, orderPayload);
  return queueMailNotification('mail_admin_' + orderId, adminEmail, subject, html, {
    type: 'order_pending',
    orderId: orderId,
    userId: orderPayload.userId,
  });
}

export async function notifyStudentOrderStatus(order, status, customMessage) {
  if (!order || !order.userEmail) return false;
  var subject = 'تحديث حالة طلبك - أكاديمية الفايبر';
  var html = buildStudentStatusHtml(status, order, customMessage);
  var suffix = status === 'approved' ? 'approved' : 'rejected';
  return queueMailNotification('mail_student_' + order.id + '_' + suffix, order.userEmail, subject, html, {
    type: 'order_' + suffix,
    orderId: order.id,
    userId: order.userId,
    extra: { adminNote: String(customMessage || '') },
  });
}
