/**
 * ProxyWalletClient implements WalletInterface by proxying all calls
 * to the auth-bridge backend's /wallet/call endpoint.
 *
 * This allows frontend code to use the managed wallet as if it were a local
 * BRC-100 wallet — same API, same method signatures.
 *
 * @example
 * ```ts
 * const wallet = new ProxyWalletClient('/auth')
 * const encrypted = await wallet.encrypt({ plaintext: [...], protocolID: [0, 'todo'], keyID: '1' })
 * ```
 */
export class ProxyWalletClient {
  private serverUrl: string

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl
  }

  private async call(method: string, params: any = {}): Promise<any> {
    const res = await fetch(`${this.serverUrl}/wallet/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ method, params })
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || `Wallet call ${method} failed`)
    }
    const data = await res.json()
    return data.result
  }

  // Action methods
  async createAction(params: any) { return this.call('createAction', params) }
  async signAction(params: any) { return this.call('signAction', params) }
  async abortAction(params: any) { return this.call('abortAction', params) }
  async listActions(params: any) { return this.call('listActions', params) }
  async listOutputs(params: any) { return this.call('listOutputs', params) }
  async internalizeAction(params: any) { return this.call('internalizeAction', params) }
  async relinquishOutput(params: any) { return this.call('relinquishOutput', params) }

  // Crypto methods
  async encrypt(params: any) { return this.call('encrypt', params) }
  async decrypt(params: any) { return this.call('decrypt', params) }
  async createHmac(params: any) { return this.call('createHmac', params) }
  async verifyHmac(params: any) { return this.call('verifyHmac', params) }
  async createSignature(params: any) { return this.call('createSignature', params) }
  async verifySignature(params: any) { return this.call('verifySignature', params) }

  // Identity methods
  async getPublicKey(params: any) { return this.call('getPublicKey', params) }
  async revealCounterpartyKeyLinkage(params: any) { return this.call('revealCounterpartyKeyLinkage', params) }
  async revealSpecificKeyLinkage(params: any) { return this.call('revealSpecificKeyLinkage', params) }

  // Certificate methods
  async acquireCertificate(params: any) { return this.call('acquireCertificate', params) }
  async listCertificates(params: any) { return this.call('listCertificates', params) }
  async proveCertificate(params: any) { return this.call('proveCertificate', params) }
  async relinquishCertificate(params: any) { return this.call('relinquishCertificate', params) }
  async discoverByIdentityKey(params: any) { return this.call('discoverByIdentityKey', params) }
  async discoverByAttributes(params: any) { return this.call('discoverByAttributes', params) }

  // Status methods
  async isAuthenticated(params: any = {}) { return this.call('isAuthenticated', params) }
  async waitForAuthentication(params: any = {}) { return this.call('waitForAuthentication', params) }
  async getVersion(params: any = {}) { return this.call('getVersion', params) }
  async getNetwork(params: any = {}) { return this.call('getNetwork', params) }
  async getHeight(params: any = {}) { return this.call('getHeight', params) }
}
