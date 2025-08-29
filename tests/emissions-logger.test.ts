import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface EmissionEntry {
  scope: number;
  amount: number;
  docHash: Buffer;
  timestamp: number;
  reportingPeriod: string;
  metadata: string;
}

interface EmissionVersion {
  updatedAmount: number;
  updateReason: string;
  updater: string;
  timestamp: number;
}

interface AuditorVerification {
  auditor: string;
  verified: boolean;
  notes: string;
  timestamp: number;
}

interface CompanySettings {
  reportingFrequency: string;
  autoAggregate: boolean;
}

interface ContractState {
  paused: boolean;
  admin: string;
  entryCounter: number;
  emissionsLog: Map<string, EmissionEntry>; // Key: `${company}-${entryId}`
  emissionsVersions: Map<string, EmissionVersion>; // Key: `${company}-${entryId}-${version}`
  auditorVerifications: Map<string, AuditorVerification>; // Key: `${company}-${entryId}`
  authorizedAuditors: Map<string, { addedBy: string; addedAt: number }>;
  companySettings: Map<string, CompanySettings>;
}

// Mock contract implementation
class EmissionsLoggerMock {
  private state: ContractState = {
    paused: false,
    admin: "deployer",
    entryCounter: 0,
    emissionsLog: new Map(),
    emissionsVersions: new Map(),
    auditorVerifications: new Map(),
    authorizedAuditors: new Map([["auditor1", { addedBy: "deployer", addedAt: Date.now() }]]),
    companySettings: new Map(),
  };

  private ERR_NOT_REGISTERED = 100;
  private ERR_UNAUTHORIZED = 101;
  private ERR_INVALID_SCOPE = 102;
  private ERR_INVALID_AMOUNT = 103;
  private ERR_INVALID_HASH = 104;
  private ERR_ALREADY_LOGGED = 105;
  private ERR_PAUSED = 106;
  private ERR_INVALID_VERSION = 107;
  private ERR_METADATA_TOO_LONG = 108;
  private ERR_INVALID_PERIOD = 109;
  private MAX_METADATA_LEN = 500;

  private isRegisteredCompany(company: string): boolean {
    // Mock: Assume all are registered except 'unregistered'
    return company !== "unregistered";
  }

  private validateScope(scope: number): boolean {
    return scope >= 1 && scope <= 3;
  }

  private validateAmount(amount: number): boolean {
    return amount > 0;
  }

  private validateHash(hash: Buffer): boolean {
    return hash.length === 32;
  }

  private validateMetadata(metadata: string): boolean {
    return metadata.length <= this.MAX_METADATA_LEN;
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  addAuditor(caller: string, auditor: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.authorizedAuditors.set(auditor, { addedBy: caller, addedAt: Date.now() });
    return { ok: true, value: true };
  }

  removeAuditor(caller: string, auditor: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.authorizedAuditors.delete(auditor);
    return { ok: true, value: true };
  }

  setCompanySettings(caller: string, frequency: string, autoAggregate: boolean): ClarityResponse<boolean> {
    if (!this.isRegisteredCompany(caller)) {
      return { ok: false, value: this.ERR_NOT_REGISTERED };
    }
    this.state.companySettings.set(caller, { reportingFrequency: frequency, autoAggregate });
    return { ok: true, value: true };
  }

  logEmissions(
    caller: string,
    scope: number,
    amount: number,
    docHash: Buffer,
    period: string,
    metadata: string
  ): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.isRegisteredCompany(caller)) {
      return { ok: false, value: this.ERR_NOT_REGISTERED };
    }
    if (
      !this.validateScope(scope) ||
      !this.validateAmount(amount) ||
      !this.validateHash(docHash) ||
      !this.validateMetadata(metadata)
    ) {
      return { ok: false, value: this.ERR_INVALID_SCOPE }; // Generic for simplicity
    }
    const entryId = this.state.entryCounter;
    const key = `${caller}-${entryId}`;
    if (this.state.emissionsLog.has(key)) {
      return { ok: false, value: this.ERR_ALREADY_LOGGED };
    }
    this.state.emissionsLog.set(key, {
      scope,
      amount,
      docHash,
      timestamp: Date.now(),
      reportingPeriod: period,
      metadata,
    });
    this.state.entryCounter += 1;
    return { ok: true, value: entryId };
  }

  updateEmission(
    caller: string,
    entryId: number,
    newAmount: number,
    reason: string,
    version: number
  ): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.isRegisteredCompany(caller)) {
      return { ok: false, value: this.ERR_NOT_REGISTERED };
    }
    const logKey = `${caller}-${entryId}`;
    if (!this.state.emissionsLog.has(logKey)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (version <= 0) {
      return { ok: false, value: this.ERR_INVALID_VERSION };
    }
    const versionKey = `${caller}-${entryId}-${version}`;
    this.state.emissionsVersions.set(versionKey, {
      updatedAmount: newAmount,
      updateReason: reason,
      updater: caller,
      timestamp: Date.now(),
    });
    return { ok: true, value: true };
  }

  verifyEmission(
    caller: string,
    company: string,
    entryId: number,
    verified: boolean,
    notes: string
  ): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.state.authorizedAuditors.has(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const logKey = `${company}-${entryId}`;
    if (!this.state.emissionsLog.has(logKey)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const verificationKey = `${company}-${entryId}`;
    this.state.auditorVerifications.set(verificationKey, {
      auditor: caller,
      verified,
      notes,
      timestamp: Date.now(),
    });
    return { ok: true, value: true };
  }

  getEmission(company: string, entryId: number): ClarityResponse<EmissionEntry | null> {
    const key = `${company}-${entryId}`;
    return { ok: true, value: this.state.emissionsLog.get(key) ?? null };
  }

  getEmissionVersion(company: string, entryId: number, version: number): ClarityResponse<EmissionVersion | null> {
    const key = `${company}-${entryId}-${version}`;
    return { ok: true, value: this.state.emissionsVersions.get(key) ?? null };
  }

  getVerification(company: string, entryId: number): ClarityResponse<AuditorVerification | null> {
    const key = `${company}-${entryId}`;
    return { ok: true, value: this.state.auditorVerifications.get(key) ?? null };
  }

  isAuditor(account: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.authorizedAuditors.has(account) };
  }

  getCompanySettings(company: string): ClarityResponse<CompanySettings | null> {
    return { ok: true, value: this.state.companySettings.get(company) ?? null };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getAdmin(): ClarityResponse<string> {
    return { ok: true, value: this.state.admin };
  }

  getTotalEntries(): ClarityResponse<number> {
    return { ok: true, value: this.state.entryCounter };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  company1: "company1",
  company2: "company2",
  auditor1: "auditor1",
  unauthorized: "unauthorized",
  unregistered: "unregistered",
};

describe("EmissionsLogger Contract", () => {
  let contract: EmissionsLoggerMock;

  beforeEach(() => {
    contract = new EmissionsLoggerMock();
    vi.resetAllMocks();
  });

  it("should allow admin to pause and unpause contract", () => {
    const pauseResult = contract.pauseContract(accounts.deployer);
    expect(pauseResult).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: true });

    const logDuringPause = contract.logEmissions(
      accounts.company1,
      1,
      1000,
      Buffer.alloc(32),
      "2025-Q1",
      "Test metadata"
    );
    expect(logDuringPause).toEqual({ ok: false, value: 106 });

    const unpauseResult = contract.unpauseContract(accounts.deployer);
    expect(unpauseResult).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
  });

  it("should prevent non-admin from pausing", () => {
    const pauseResult = contract.pauseContract(accounts.unauthorized);
    expect(pauseResult).toEqual({ ok: false, value: 101 });
  });

  it("should allow admin to add and remove auditor", () => {
    const addResult = contract.addAuditor(accounts.deployer, accounts.auditor1);
    expect(addResult).toEqual({ ok: true, value: true });
    expect(contract.isAuditor(accounts.auditor1)).toEqual({ ok: true, value: true });

    const removeResult = contract.removeAuditor(accounts.deployer, accounts.auditor1);
    expect(removeResult).toEqual({ ok: true, value: true });
    expect(contract.isAuditor(accounts.auditor1)).toEqual({ ok: true, value: false });
  });

  it("should allow company to set settings", () => {
    const setResult = contract.setCompanySettings(accounts.company1, "quarterly", true);
    expect(setResult).toEqual({ ok: true, value: true });
    expect(contract.getCompanySettings(accounts.company1)).toEqual({
      ok: true,
      value: { reportingFrequency: "quarterly", autoAggregate: true },
    });
  });

  it("should prevent unregistered company from setting settings", () => {
    const setResult = contract.setCompanySettings(accounts.unregistered, "quarterly", true);
    expect(setResult).toEqual({ ok: false, value: 100 });
  });

  it("should allow company to log emissions", () => {
    const logResult = contract.logEmissions(
      accounts.company1,
      1,
      1000,
      Buffer.alloc(32),
      "2025-Q1",
      "Test metadata"
    );
    expect(logResult).toEqual({ ok: true, value: 0 });
    expect(contract.getTotalEntries()).toEqual({ ok: true, value: 1 });

    const entry = contract.getEmission(accounts.company1, 0);
    expect(entry).toEqual({
      ok: true,
      value: expect.objectContaining({
        scope: 1,
        amount: 1000,
        reportingPeriod: "2025-Q1",
        metadata: "Test metadata",
      }),
    });
  });

  it("should prevent invalid scope in logging", () => {
    const logResult = contract.logEmissions(
      accounts.company1,
      4,
      1000,
      Buffer.alloc(32),
      "2025-Q1",
      "Test metadata"
    );
    expect(logResult).toEqual({ ok: false, value: 102 });
  });

  it("should prevent metadata too long", () => {
    const longMetadata = "a".repeat(501);
    const logResult = contract.logEmissions(
      accounts.company1,
      1,
      1000,
      Buffer.alloc(32),
      "2025-Q1",
      longMetadata
    );
    expect(logResult).toEqual({ ok: false, value: 102 }); // Uses generic invalid
  });

  it("should allow company to update emission with version", () => {
    contract.logEmissions(
      accounts.company1,
      1,
      1000,
      Buffer.alloc(32),
      "2025-Q1",
      "Test metadata"
    );

    const updateResult = contract.updateEmission(accounts.company1, 0, 1200, "Correction", 1);
    expect(updateResult).toEqual({ ok: true, value: true });

    const version = contract.getEmissionVersion(accounts.company1, 0, 1);
    expect(version).toEqual({
      ok: true,
      value: expect.objectContaining({
        updatedAmount: 1200,
        updateReason: "Correction",
      }),
    });
  });

  it("should prevent invalid version in update", () => {
    contract.logEmissions(
      accounts.company1,
      1,
      1000,
      Buffer.alloc(32),
      "2025-Q1",
      "Test metadata"
    );

    const updateResult = contract.updateEmission(accounts.company1, 0, 1200, "Correction", 0);
    expect(updateResult).toEqual({ ok: false, value: 107 });
  });

  it("should allow auditor to verify emission", () => {
    contract.logEmissions(
      accounts.company1,
      1,
      1000,
      Buffer.alloc(32),
      "2025-Q1",
      "Test metadata"
    );

    const verifyResult = contract.verifyEmission(accounts.auditor1, accounts.company1, 0, true, "All good");
    expect(verifyResult).toEqual({ ok: true, value: true });

    const verification = contract.getVerification(accounts.company1, 0);
    expect(verification).toEqual({
      ok: true,
      value: expect.objectContaining({
        verified: true,
        notes: "All good",
      }),
    });
  });

  it("should prevent non-auditor from verifying", () => {
    contract.logEmissions(
      accounts.company1,
      1,
      1000,
      Buffer.alloc(32),
      "2025-Q1",
      "Test metadata"
    );

    const verifyResult = contract.verifyEmission(accounts.unauthorized, accounts.company1, 0, true, "Unauthorized");
    expect(verifyResult).toEqual({ ok: false, value: 101 });
  });
});