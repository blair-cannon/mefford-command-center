# Plaid Layer bank and credit-card connection

Main: Cash Management → Bank And Credit Accounts.

## Activation

1. Ask Plaid to enable Layer for the organization. Configure a Layer template with Transactions enabled and bank/credit-card account selection. Layer currently serves US users. Do not enable identity/SSN collection for this accounting use case unless separately required and approved.
2. Add this exact allowed OAuth redirect URI in the Plaid Dashboard:
   `https://meffops.com/accounting/plaid-return`
3. Configure these server-side Worker environment variables. Keep secrets out of source code and chat:
   - `PLAID_CLIENT_ID`: Plaid application client ID.
   - `PLAID_SECRET`: production secret, stored as a secret.
   - `PLAID_ENV`: `production` for live accounts, `sandbox` for isolated connection testing.
   - `PLAID_LAYER_TEMPLATE_ID`: enabled template ID for the selected environment.
   - `PLAID_TOKEN_ENCRYPTION_KEY`: base64 encoding of 32 cryptographically random bytes, stored as a secret. Preserve this key while connections exist. Rotation requires re-encrypting existing tokens or disconnecting and linking again.
4. Redeploy (`npm run deploy`) to apply environment changes. Complete the Plaid production application and institution OAuth registration/approval required by Plaid before live linking.
5. Validate Layer with an eligible test profile, Link fallback, bank OAuth return, credit-card account selection, reconnect, and disconnect. Provider responses in automated tests are synthetic; live institution access has not been certified.

## Operation

- Layer uses `/session/token/create`, the official Link JavaScript SDK, phone submission, and `/user_account/session/get`. Ineligible Layer users fall back to standard Link; standard Link uses `/link/token/create` and `/item/public_token/exchange`.
- Session IDs are bound to the authenticated accounting user. OAuth resume uses an HttpOnly cookie and the same encrypted server-held Link token. Tokens and unnecessary Layer identity data are never exposed in account-list responses. Only Company Owners, Accountants, and Financial Administrators may use the endpoint.
- After linking, assign each USD account to an existing accounting account or create one. Assignment is explicit to avoid merging accounts by names or masks. One active Plaid account may map to each accounting account. Use Reconnect on existing connections rather than adding duplicates.
- Sync Transactions imports available Plaid transactions on demand. There is no scheduled polling, webhook processing, payment, transfer, or automatic general-ledger posting. The last sync time is displayed. Newly linked Items may take time to populate Transactions.
- Positive provider outflows become negative bank-feed amounts; deposits and refunds become positive. Pending transactions remain in Pending status and cannot be matched. Changes to a matched transaction reopen its book match for review; removed entries retain their history. Approved reconciliation documents and posted journals are not rewritten by this feed.
- Credit-card balances are liabilities and are excluded from opening cash in the 13-week forecast. Provider balances never replace book balances.
- Sandbox linking and account refresh are supported, but sandbox accounts cannot map to live accounting or import test transactions. Changing environments does not make existing connections usable in the new environment.
- Disconnect revokes the Plaid Item and removes its saved access token while retaining accounting records. A fresh connection can then be assigned to the retained accounting account.

## Verification references

- https://plaid.com/docs/layer/add-to-app/
- https://plaid.com/docs/api/products/layer/
- https://plaid.com/docs/link/oauth/
- https://plaid.com/docs/api/products/transactions/
