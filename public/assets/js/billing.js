import { getClient, api } from './client.js';

const schoolSelect = document.querySelector('#school-id');
const planSelect = document.querySelector('#plan-id');
const periodSelect = document.querySelector('#billing-period');
const providerSelect = document.querySelector('#provider');
const status = document.querySelector('#billing-status');
const notice = document.querySelector('#checkout-notice');
let eligibleSchools = [];
let billingData;
function addOption(select, value, label, disabled = false) { const el = document.createElement('option'); el.value = value; el.textContent = label; el.disabled = disabled; select.append(el); }
function money(amount, currency = 'NGN') { return new Intl.NumberFormat('en-NG',{style:'currency',currency,maximumFractionDigits:0}).format(amount); }
async function loadBilling() {
  const selectedSchool = eligibleSchools.find(({ school }) => school.id === schoolSelect.value)?.school;
  if (!selectedSchool) return;
  billingData = await api(`/api/billing?schoolId=${encodeURIComponent(selectedSchool.id)}`);
  planSelect.replaceChildren();
  billingData.plans.filter((plan) => ['starter','premium'].includes(plan.id)).forEach((plan) => addOption(planSelect, plan.id, `${plan.name} · ${money(plan.monthly_price,plan.currency)} monthly`));
  providerSelect.replaceChildren();
  if (billingData.providers.paystack) addOption(providerSelect,'paystack','Paystack');
  if (billingData.providers.flutterwave) addOption(providerSelect,'flutterwave','Flutterwave');
  if (!providerSelect.options.length) addOption(providerSelect,'','No payment provider is configured',true);
  providerSelect.disabled = !providerSelect.options.length || !providerSelect.value;
  syncAnnual();
  const sub = billingData.subscription;
  const summary = document.querySelector('#current-subscription'); summary.replaceChildren();
  if (sub) {
    const heading = document.createElement('strong'); heading.textContent = sub.subscription_plans?.name || sub.plan_id;
    const detail = document.createElement('p'); detail.textContent = `${sub.status.replace('_',' ')} · ${sub.billing_period}`;
    const expires = document.createElement('small'); expires.textContent = sub.trial_ends_at ? `Trial ends ${new Date(sub.trial_ends_at).toLocaleDateString()}` : sub.current_period_end ? `Period ends ${new Date(sub.current_period_end).toLocaleDateString()}` : 'No period end date set';
    summary.append(heading,detail,expires);
  } else summary.textContent = 'No active subscription found.';
  status.textContent = `Billing controls for ${selectedSchool.name}.`;
}
function syncAnnual() {
  const selected = billingData?.plans.find((plan) => plan.id === planSelect.value);
  const annualOption = [...periodSelect.options].find((option) => option.value === 'annual');
  annualOption.disabled = !selected?.annual_price;
  if (annualOption.disabled && periodSelect.value === 'annual') periodSelect.value = 'monthly';
  annualOption.textContent = selected?.annual_price ? `Annual · ${money(selected.annual_price,selected.currency)}` : 'Annual · not configured yet';
}
planSelect.addEventListener('change', syncAnnual);
schoolSelect.addEventListener('change', loadBilling);
periodSelect.addEventListener('change', syncAnnual);
document.querySelector('#checkout-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
  notice.textContent = 'Creating secure checkout...'; notice.className = 'form-notice';
  try {
    const result = await api('/api/payments/initialize',{method:'POST',body:JSON.stringify({schoolId:schoolSelect.value,planId:planSelect.value,billingPeriod:periodSelect.value,provider:providerSelect.value})});
    location.assign(result.checkoutUrl);
  } catch (error) { notice.textContent = error.message; notice.className = 'form-notice is-error'; button.disabled = false; }
});
document.querySelector('#sign-out')?.addEventListener('click',async()=>{const client=await getClient();await client.auth.signOut();location.assign('/login.html');});

async function init() {
  try {
    const client = await getClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session) { location.replace('/login.html'); return; }
    if (session.user?.user_metadata?.must_change_password) { location.replace('/reset-password.html?required=1'); return; }
    const data = await api('/api/me');
    eligibleSchools = data.schools.filter(({ role }) => ['owner','admin'].includes(role));
    if (!eligibleSchools.length) { status.textContent = 'Billing is available to school owners and administrators.'; document.querySelector('#checkout-form').hidden = true; return; }
    eligibleSchools.forEach(({ school }) => addOption(schoolSelect,school.id,school.name));
    const params = new URLSearchParams(location.search);
    const reference = params.get('reference') || params.get('tx_ref');
    const transactionId = params.get('transaction_id');
    if (reference && params.get('status') !== 'cancelled') {
      notice.textContent = 'Verifying your payment with the provider...'; notice.className = 'form-notice';
      try {
        const result = await api('/api/payments/verify',{method:'POST',body:JSON.stringify({reference,transactionId})});
        notice.textContent = `Payment verified. Your subscription is active through ${new Date(result.subscription.currentPeriodEnd).toLocaleDateString()}.`;
        notice.className = 'form-notice is-success'; history.replaceState({},'',location.pathname);
      } catch (error) { notice.textContent = error.message; notice.className = 'form-notice is-error'; }
    } else if (params.get('status') === 'cancelled') { notice.textContent = 'Checkout was cancelled. No payment was verified.'; notice.className = 'form-notice'; history.replaceState({},'',location.pathname); }
    await loadBilling();
  } catch (error) { status.textContent = error.message || 'Could not load billing information.'; }
}
init();
