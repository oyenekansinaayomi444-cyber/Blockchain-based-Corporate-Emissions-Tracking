;; EmissionsLogger.clar
;; Sophisticated smart contract for immutable logging of corporate emissions data
;; on the Stacks blockchain. Supports multiple scopes, hashing, versioned updates, auditor notes, aggregation, and access controls.

;; Constants
(define-constant ERR-NOT-REGISTERED u100)
(define-constant ERR-UNAUTHORIZED u101)
(define-constant ERR-INVALID-SCOPE u102)
(define-constant ERR-INVALID-AMOUNT u103)
(define-constant ERR-INVALID-HASH u104)
(define-constant ERR-ALREADY-LOGGED u105)
(define-constant ERR-PAUSED u106)
(define-constant ERR-INVALID-VERSION u107)
(define-constant ERR-METADATA-TOO-LONG u108)
(define-constant ERR-INVALID-PERIOD u109)
(define-constant ERR-INVALID-STRING-LEN u110)
(define-constant MAX-METADATA-LEN u500)
(define-constant MAX-REASON-LEN u200)
(define-constant MAX-NOTES-LEN u300)
(define-constant MAX-FREQUENCY-LEN u10)
(define-constant MAX-PERIOD-LEN u10)

;; Data Variables
(define-data-var contract-paused bool false)
(define-data-var admin principal tx-sender)
(define-data-var entry-counter uint u0)

;; Data Maps
(define-map emissions-log
  { company: principal, entry-id: uint }
  {
    scope: uint,
    amount: uint,
    doc-hash: (buff 32),
    timestamp: uint,
    reporting-period: (string-ascii 10),
    metadata: (string-utf8 500)
  }
)

(define-map emissions-versions
  { company: principal, entry-id: uint, version: uint }
  {
    updated-amount: uint,
    update-reason: (string-utf8 200),
    updater: principal,
    timestamp: uint
  }
)

(define-map auditor-verifications
  { company: principal, entry-id: uint }
  {
    auditor: principal,
    verified: bool,
    notes: (string-utf8 300),
    timestamp: uint
  }
)

(define-map authorized-auditors
  { auditor: principal }
  { added-by: principal, added-at: uint }
)

(define-map company-settings
  { company: principal }
  {
    reporting-frequency: (string-ascii 10),
    auto-aggregate: bool
  }
)

;; Private Functions
(define-private (is-registered-company (company principal))
  ;; Placeholder: Replace with CompanyRegistry.is-registered call
  true
)

(define-private (validate-scope (scope uint))
  (and (>= scope u1) (<= scope u3))
)

(define-private (validate-amount (amount uint))
  (> amount u0)
)

(define-private (validate-hash (hash (buff 32)))
  (is-eq (len hash) u32)
)

(define-private (validate-metadata (metadata (string-utf8 500)))
  (<= (len metadata) MAX-METADATA-LEN)
)

(define-private (validate-period (period (string-ascii 10)))
  (let
    ((len-ok (<= (len period) MAX-PERIOD-LEN))
     (matches-format (is-some (string-to-uint (slice? period u0 u4)))))
    (and len-ok matches-format)
  )
)

(define-private (validate-string-ascii (str (string-ascii 10)) (max-len uint))
  (<= (len str) max-len)
)

(define-private (validate-string-utf8 (str (string-utf8 500)) (max-len uint))
  (<= (len str) max-len)
)

(define-private (validate-principal (p principal))
  (not (is-eq p 'SP000000000000000000002Q6VF78)) ;; Blacklist zero principal
)

;; Public Functions

(define-public (pause-contract)
  (if (is-eq tx-sender (var-get admin))
    (begin
      (var-set contract-paused true)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (unpause-contract)
  (if (is-eq tx-sender (var-get admin))
    (begin
      (var-set contract-paused false)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (add-auditor (auditor principal))
  (if (is-eq tx-sender (var-get admin))
    (if (validate-principal auditor)
      (begin
        (map-set authorized-auditors {auditor: auditor} {added-by: tx-sender, added-at: block-height})
        (ok true)
      )
      (err ERR-UNAUTHORIZED)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (remove-auditor (auditor principal))
  (if (is-eq tx-sender (var-get admin))
    (if (validate-principal auditor)
      (begin
        (map-delete authorized-auditors {auditor: auditor})
        (ok true)
      )
      (err ERR-UNAUTHORIZED)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (set-company-settings (frequency (string-ascii 10)) (auto-aggregate bool))
  (if (is-registered-company tx-sender)
    (if (validate-string-ascii frequency MAX-FREQUENCY-LEN)
      (begin
        (map-set company-settings {company: tx-sender} {reporting-frequency: frequency, auto-aggregate: auto-aggregate})
        (ok true)
      )
      (err ERR-INVALID-STRING-LEN)
    )
    (err ERR-NOT-REGISTERED)
  )
)

(define-public (log-emissions (scope uint) (amount uint) (doc-hash (buff 32)) (period (string-ascii 10)) (metadata (string-utf8 500)))
  (if (var-get contract-paused)
    (err ERR-PAUSED)
    (if (is-registered-company tx-sender)
      (if (and
            (validate-scope scope)
            (validate-amount amount)
            (validate-hash doc-hash)
            (validate-metadata metadata)
            (validate-period period))
        (let
          ((entry-id (var-get entry-counter))
           (existing (map-get? emissions-log {company: tx-sender, entry-id: entry-id})))
          (if (is-some existing)
            (err ERR-ALREADY-LOGGED)
            (begin
              (map-set emissions-log
                {company: tx-sender, entry-id: entry-id}
                {
                  scope: scope,
                  amount: amount,
                  doc-hash: doc-hash,
                  timestamp: block-height,
                  reporting-period: period,
                  metadata: metadata
                }
              )
              (var-set entry-counter (+ entry-id u1))
              (print {event: "emissions-logged", company: tx-sender, entry-id: entry-id, amount: amount, scope: scope, period: period})
              (ok entry-id)
            )
          )
        )
        (err ERR-INVALID-SCOPE)
      )
      (err ERR-NOT-REGISTERED)
    )
  )
)

(define-public (update-emission (entry-id uint) (new-amount uint) (reason (string-utf8 200)) (version uint))
  (if (var-get contract-paused)
    (err ERR-PAUSED)
    (if (is-registered-company tx-sender)
      (let
        ((original (map-get? emissions-log {company: tx-sender, entry-id: entry-id})))
        (if (is-some original)
          (if (and (> version u0) (validate-amount new-amount) (validate-string-utf8 reason MAX-REASON-LEN))
            (begin
              (map-set emissions-versions
                {company: tx-sender, entry-id: entry-id, version: version}
                {
                  updated-amount: new-amount,
                  update-reason: reason,
                  updater: tx-sender,
                  timestamp: block-height
                }
              )
              (print {event: "emission-updated", company: tx-sender, entry-id: entry-id, version: version, new-amount: new-amount})
              (ok true)
            )
            (err ERR-INVALID-VERSION)
          )
          (err ERR-UNAUTHORIZED)
        )
      )
      (err ERR-NOT-REGISTERED)
    )
  )
)

(define-public (verify-emission (company principal) (entry-id uint) (verified bool) (notes (string-utf8 300)))
  (if (var-get contract-paused)
    (err ERR-PAUSED)
    (if (validate-principal company)
      (match (map-get? authorized-auditors {auditor: tx-sender})
        some-auditor
        (let
          ((existing-log (map-get? emissions-log {company: company, entry-id: entry-id})))
          (if (and (is-some existing-log) (validate-string-utf8 notes MAX-NOTES-LEN))
            (begin
              (map-set auditor-verifications
                {company: company, entry-id: entry-id}
                {
                  auditor: tx-sender,
                  verified: verified,
                  notes: notes,
                  timestamp: block-height
                }
              )
              (print {event: "emission-verified", company: company, entry-id: entry-id, verified: verified})
              (ok true)
            )
            (err ERR-UNAUTHORIZED)
          )
        )
        (err ERR-UNAUTHORIZED)
      )
      (err ERR-UNAUTHORIZED)
    )
  )
)

;; Read-Only Functions
(define-read-only (get-emission (company principal) (entry-id uint))
  (map-get? emissions-log {company: company, entry-id: entry-id})
)

(define-read-only (get-emission-version (company principal) (entry-id uint) (version uint))
  (map-get? emissions-versions {company: company, entry-id: entry-id, version: version})
)

(define-read-only (get-verification (company principal) (entry-id uint))
  (map-get? auditor-verifications {company: company, entry-id: entry-id})
)

(define-read-only (is-auditor (account principal))
  (is-some (map-get? authorized-auditors {auditor: account}))
)

(define-read-only (get-company-settings (company principal))
  (map-get? company-settings {company: company})
)

(define-read-only (is-paused)
  (var-get contract-paused)
)

(define-read-only (get-admin)
  (var-get admin)
)

(define-read-only (get-total-entries)
  (var-get entry-counter)
)

(define-read-only (get-total-emissions (company principal) (start-id uint) (end-id uint))
  (let
    ((ids (list
      u0 u1 u2 u3 u4 u5 u6 u7 u8 u9
      u10 u11 u12 u13 u14 u15 u16 u17 u18 u19
      u20 u21 u22 u23 u24 u25 u26 u27 u28 u29
      u30 u31 u32 u33 u34 u35 u36 u37 u38 u39
      u40 u41 u42 u43 u44 u45 u46 u47 u48 u49
    )))
    (fold aggregate-emissions ids {total: u0, company: company, start-id: start-id, end-id: end-id})
  )
)

(define-private (aggregate-emissions (id uint) (acc {total: uint, company: principal, start-id: uint, end-id: uint}))
  (if (and (>= id (get start-id acc)) (<= id (get end-id acc)))
    (match (map-get? emissions-log {company: (get company acc), entry-id: id})
      entry (merge acc {total: (+ (get total acc) (get amount entry))})
      acc
    )
    acc
  )
)