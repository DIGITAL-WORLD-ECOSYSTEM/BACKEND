import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import { users } from '../user/tables';

/**
 * ============================================================================
 * WEB3 / BLOCKCHAIN DOMAIN
 * ============================================================================
 *
 * Responsibility:
 * - Blockchain networks
 * - Smart contracts
 * - Platform-controlled internal wallets
 * - User-linked external wallets
 * - Blockchain transaction lifecycle
 * - Blockchain execution state
 *
 * Explicit boundaries:
 * - Authentication belongs to authentication/
 * - Civil identity / KYC belongs to civil-identity/
 * - Authorization belongs to authorization/
 * - Financial accounting belongs to finance/
 *
 * Web3 MUST NOT own:
 * - financial ledger
 * - financial balances
 * - accounting entries
 * - financial fee accounting
 * - private keys / seed phrases / mnemonics
 *
 * ----------------------------------------------------------------------------
 * WALLET MODEL
 * ----------------------------------------------------------------------------
 *
 * A user may have:
 *
 * - 0..N historical internal wallets
 * - 0..1 ACTIVE internal wallet
 * - 0..N external wallets
 *
 * Internal wallet:
 * - controlled by the platform
 * - requires key-management references
 * - may be primary
 * - may be rotated/revoked historically
 *
 * External wallet:
 * - linked by the user
 * - controlled outside the platform
 * - never primary
 * - never stores platform key-management references
 *
 * Wallets are historical entities and must never be physically deleted.
 *
 * ----------------------------------------------------------------------------
 * ADDRESS MODEL
 * ----------------------------------------------------------------------------
 *
 * address:
 *   Original EVM address.
 *
 * addressNormalized:
 *   Lowercase canonical EVM address.
 *
 * Blockchain identity:
 *
 *   network + addressNormalized
 *
 * ----------------------------------------------------------------------------
 * TRANSACTION MODEL
 * ----------------------------------------------------------------------------
 *
 * web3Transactions stores blockchain technical state.
 *
 * It is NOT the financial transaction and NOT the financial ledger.
 *
 * Finance should reference Web3 settlement from its own financial/crypto
 * tables rather than moving accounting responsibilities into this module.
 *
 * ----------------------------------------------------------------------------
 * SECURITY
 * ----------------------------------------------------------------------------
 *
 * keyProvider/keyReference are REFERENCES ONLY.
 *
 * NEVER store:
 * - privateKey
 * - mnemonic
 * - seed phrase
 * - decrypted key material
 * - KMS/HSM secrets
 *
 * ----------------------------------------------------------------------------
 * IMMUTABILITY
 * ----------------------------------------------------------------------------
 *
 * The following wallet identity fields should be immutable after creation:
 *
 * - userId
 * - provenance
 * - networkId
 * - walletType
 * - address
 * - addressNormalized
 *
 * Repository policies and/or database triggers should enforce this in the
 * infrastructure/migration layer.
 * ============================================================================
 */

/* ============================================================================
 * 1. WEB3 NETWORKS
 * ========================================================================== */

export const web3Networks = sqliteTable(
  'web3_networks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    name: text('name').notNull(),

    /**
     * Canonical identifier.
     *
     * V1 convention:
     *
     *   eip155:<chainId>
     *
     * Examples:
     *   eip155:1
     *   eip155:137
     *   eip155:8453
     */
    identifier: text('identifier').notNull(),

    chainId: integer('chain_id').notNull(),

    namespace: text('namespace', {
      enum: ['eip155'],
    }).notNull(),

    networkType: text('network_type', {
      enum: ['mainnet', 'testnet', 'local'],
    }).notNull(),

    /**
     * Application execution environment.
     *
     * This is intentionally separate from networkType.
     *
     * Examples that may legitimately exist:
     * - mainnet + production
     * - mainnet + staging
     * - testnet + staging
     * - testnet + development
     * - local + development
     */
    environment: text('environment', {
      enum: ['production', 'staging', 'development'],
    }).notNull(),

    status: text('status', {
      enum: ['active', 'deprecated', 'suspended'],
    })
      .notNull()
      .default('active'),

    version: integer('version').notNull().default(1),

    /**
     * Technical reference to the native financial asset.
     *
     * This intentionally avoids importing Finance tables into Web3.
     */
    nativeAssetReference: text('native_asset_reference'),

    /**
     * RPC infrastructure references.
     *
     * These are configuration references only.
     * No credentials/secrets belong here.
     */
    rpcProvider: text('rpc_provider'),
    rpcEndpointReference: text('rpc_endpoint_reference'),

    /**
     * Optional blockchain explorer base URL.
     *
     * Example:
     *   https://etherscan.io
     */
    explorerBaseUrl: text('explorer_base_url'),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    chainUnique: uniqueIndex(
      'uq_web3_networks_chain',
    ).on(
      table.namespace,
      table.chainId,
    ),

    identifierUnique: uniqueIndex(
      'uq_web3_networks_identifier',
    ).on(table.identifier),

    chainIdCheck: check(
      'ck_web3_networks_chain_id',
      sql`${table.chainId} > 0`,
    ),

    identifierCheck: check(
      'ck_web3_networks_identifier',
      sql`
        ${table.identifier}
        = ${table.namespace} || ':' || ${table.chainId}
      `,
    ),

    nameNotEmptyCheck: check(
      'ck_web3_networks_name_not_empty',
      sql`length(trim(${table.name})) > 0`,
    ),

    identifierNotEmptyCheck: check(
      'ck_web3_networks_identifier_not_empty',
      sql`length(trim(${table.identifier})) > 0`,
    ),

    versionCheck: check(
      'ck_web3_networks_version',
      sql`${table.version} > 0`,
    ),
  }),
);

/* ============================================================================
 * 2. SMART CONTRACTS
 * ========================================================================== */

export const smartContracts = sqliteTable(
  'smart_contracts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    networkId: integer('network_id')
      .notNull()
      .references(() => web3Networks.id, {
        onDelete: 'restrict',
      }),

    address: text('address').notNull(),

    /**
     * Lowercase canonical EVM address.
     */
    addressNormalized: text('address_normalized').notNull(),

    name: text('name').notNull(),

    type: text('type', {
      enum: [
        'erc20',
        'erc721',
        'erc1155',
        'dao_governance',
        'treasury',
        'escrow',
        'multisig',
        'account_abstraction',
        'proxy',
        'bridge',
        'staking',
        'other',
      ],
    }).notNull(),

    /**
     * Deployment / application-level version.
     */
    version: text('version').notNull().default('1.0.0'),

    status: text('status', {
      enum: ['active', 'deprecated', 'suspended'],
    })
      .notNull()
      .default('active'),

    rowVersion: integer('row_version').notNull().default(1),

    /**
     * Technical metadata only.
     *
     * Never store secrets.
     */
    metadata: text('metadata', {
      mode: 'json',
    }),

    /**
     * Optional deployment transaction hash.
     */
    deploymentTxHash: text('deployment_tx_hash'),

    /**
     * Optional explorer URL.
     */
    explorerUrl: text('explorer_url'),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    /**
     * Same contract address may exist on different networks.
     * Same network + normalized address may exist only once.
     */
    addressUnique: uniqueIndex(
      'uq_smart_contracts_network_address',
    ).on(
      table.networkId,
      table.addressNormalized,
    ),

    typeIdx: index(
      'idx_smart_contracts_type',
    ).on(table.type),

    networkStatusIdx: index(
      'idx_smart_contracts_network_status',
    ).on(
      table.networkId,
      table.status,
    ),

    deploymentTxIdx: index(
      'idx_smart_contracts_deployment_tx',
    ).on(
      table.networkId,
      table.deploymentTxHash,
    ),

    addressCheck: check(
      'ck_smart_contracts_address',
      sql`
        ${table.address} LIKE '0x%'
        AND length(${table.address}) = 42
        AND substr(${table.address}, 3) NOT GLOB '*[^0-9A-Fa-f]*'
      `,
    ),

    normalizedAddressCheck: check(
      'ck_smart_contracts_address_normalized',
      sql`
        ${table.addressNormalized} LIKE '0x%'
        AND length(${table.addressNormalized}) = 42
        AND substr(${table.addressNormalized}, 3) NOT GLOB '*[^0-9A-Fa-f]*'
      `,
    ),

    normalizedLowercaseCheck: check(
      'ck_smart_contracts_address_normalized_lowercase',
      sql`
        ${table.addressNormalized}
        = lower(${table.addressNormalized})
      `,
    ),

    normalizedMatchesAddressCheck: check(
      'ck_smart_contracts_address_normalized_matches',
      sql`
        ${table.addressNormalized}
        = lower(${table.address})
      `,
    ),

    deploymentTxHashCheck: check(
      'ck_smart_contracts_deployment_tx_hash',
      sql`
        ${table.deploymentTxHash} IS NULL
        OR (
          ${table.deploymentTxHash} LIKE '0x%'
          AND length(${table.deploymentTxHash}) = 66
          AND substr(${table.deploymentTxHash}, 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      `,
    ),

    nameNotEmptyCheck: check(
      'ck_smart_contracts_name_not_empty',
      sql`length(trim(${table.name})) > 0`,
    ),

    rowVersionCheck: check(
      'ck_smart_contracts_row_version',
      sql`${table.rowVersion} > 0`,
    ),
  }),
);

/* ============================================================================
 * 3. WALLETS
 * ========================================================================== */

export const wallets = sqliteTable(
  'wallets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, {
        /**
         * Wallets are historical and must survive user lifecycle operations.
         */
        onDelete: 'restrict',
      }),

    /**
     * internal:
     *   Platform-controlled/custodial wallet.
     *
     * external:
     *   User-linked non-custodial wallet.
     *
     * No default is intentionally used.
     * The caller must explicitly choose the provenance.
     */
    provenance: text('provenance', {
      enum: ['internal', 'external'],
    }).notNull(),

    networkId: integer('network_id')
      .notNull()
      .references(() => web3Networks.id, {
        onDelete: 'restrict',
      }),

    /**
     * V1 wallet types.
     */
    walletType: text('wallet_type', {
      enum: ['eoa', 'smart_contract'],
    }).notNull(),

    controlMode: text('control_mode', {
      enum: ['platform_key', 'external_user', 'contract_controller'],
    }).notNull(),

    controllerWalletId: integer('controller_wallet_id'),

    /**
     * Original EVM address.
     */
    address: text('address').notNull(),

    /**
     * Lowercase canonical EVM address.
     */
    addressNormalized: text('address_normalized').notNull(),

    label: text('label'),

    /**
     * Platform key-management references.
     *
     * These fields never contain actual secret/key material.
     */
    keyProvider: text('key_provider'),
    keyReference: text('key_reference'),
    keyVersion: integer('key_version'),

    /**
     * Wallet lifecycle.
     *
     * revoked and unlinked are historical terminal states.
     */
    status: text('status', {
      enum: [
        'pending',
        'active',
        'suspended',
        'revoked',
        'unlinked',
      ],
    })
      .notNull()
      .default('pending'),

    /**
     * Wallet ownership verification.
     *
     * This is NOT KYC.
     */
    verificationStatus: text('verification_status', {
      enum: ['pending', 'verified', 'rejected'],
    })
      .notNull()
      .default('pending'),

    verificationMethod: text('verification_method', {
      enum: ['signature', 'challenge', 'manual', 'system'],
    }),

    /**
     * Only an active internal wallet may be primary.
     */
    isPrimary: integer('is_primary', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),

    linkedAt: integer('linked_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull(),

    verifiedAt: integer('verified_at', {
      mode: 'timestamp',
    }),

    verifiedBy: integer('verified_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    suspendedAt: integer('suspended_at', {
      mode: 'timestamp',
    }),

    revokedAt: integer('revoked_at', {
      mode: 'timestamp',
    }),

    unlinkedAt: integer('unlinked_at', {
      mode: 'timestamp',
    }),

    /**
     * Last successful wallet ownership/authentication challenge.
     */
    lastOwnershipVerifiedAt: integer('last_ownership_verified_at', {
      mode: 'timestamp',
    }),

    /**
     * Optimistic locking.
     */
    version: integer('version').notNull().default(1),

    /**
     * Non-sensitive auxiliary metadata.
     */
    metadata: text('metadata', {
      mode: 'json',
    }),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    controllerFk: foreignKey({
      columns: [table.controllerWalletId],
      foreignColumns: [table.id],
      name: 'fk_wallets_controller',
    }).onDelete('restrict'),

    /**
     * A wallet cannot be its own controller.
     */
    controllerSelfCheck: check(
      'ck_wallets_controller_self',
      sql`
        ${table.controllerWalletId} IS NULL
        OR ${table.controllerWalletId} != ${table.id}
      `,
    ),

    /**
     * Global blockchain identity:
     *
     * network + addressNormalized
     */
    addressUnique: uniqueIndex(
      'uq_wallets_network_address_normalized',
    ).on(
      table.networkId,
      table.addressNormalized,
    ),

    /**
     * At most one primary wallet per user.
     */
    primaryUnique: uniqueIndex(
      'uq_wallets_primary_user',
    )
      .on(table.userId)
      .where(sql`${table.isPrimary} = true`),

    /**
     * At most one active internal wallet per user.
     *
     * Historical revoked/unlinked internal wallets are preserved.
     */
    internalActiveUnique: uniqueIndex(
      'uq_wallets_internal_active_user',
    )
      .on(table.userId)
      .where(
        sql`
          ${table.provenance} = 'internal'
          AND ${table.status} = 'active'
        `,
      ),

    /**
     * Required so web3Transactions can establish:
     *
     * (walletId, networkId)
     *   -> wallets(id, networkId)
     */
    idNetworkUnique: uniqueIndex(
      'uq_wallets_id_network',
    ).on(
      table.id,
      table.networkId,
    ),

    userStatusIdx: index(
      'idx_wallets_user_status',
    ).on(
      table.userId,
      table.status,
    ),

    userProvenanceStatusIdx: index(
      'idx_wallets_user_provenance_status',
    ).on(
      table.userId,
      table.provenance,
      table.status,
    ),

    verificationIdx: index(
      'idx_wallets_verification_status',
    ).on(table.verificationStatus),

    networkStatusIdx: index(
      'idx_wallets_network_status',
    ).on(
      table.networkId,
      table.status,
    ),

    lastAuthIdx: index(
      'idx_wallets_last_ownership_verified',
    ).on(table.lastOwnershipVerifiedAt),

    /**
     * Primary MUST be internal + active.
     */
    primaryInternalActiveCheck: check(
      'ck_wallets_primary_internal_active',
      sql`
        ${table.isPrimary} = false
        OR (
          ${table.provenance} = 'internal'
          AND ${table.status} = 'active'
        )
      `,
    ),

    /**
     * Internal wallet MUST have platform key-management references, UNLESS it is a contract_controller.
     */
    internalKeyReferenceCheck: check(
      'ck_wallets_internal_key_reference',
      sql`
        ${table.provenance} != 'internal'
        OR ${table.controlMode} = 'contract_controller'
        OR (
          ${table.keyProvider} IS NOT NULL
          AND length(trim(${table.keyProvider})) > 0
          AND ${table.keyReference} IS NOT NULL
          AND length(trim(${table.keyReference})) > 0
        )
      `,
    ),

    /**
     * External wallet MUST NOT use platform key-management references.
     */
    externalKeyReferenceCheck: check(
      'ck_wallets_external_key_reference',
      sql`
        ${table.provenance} != 'external'
        OR (
          ${table.keyProvider} IS NULL
          AND ${table.keyReference} IS NULL
        )
      `,
    ),

    keyVersionCheck: check(
      'ck_wallets_key_version',
      sql`
        ${table.keyVersion} IS NULL
        OR ${table.keyVersion} > 0
      `,
    ),

    versionCheck: check(
      'ck_wallets_version',
      sql`${table.version} > 0`,
    ),

    addressCheck: check(
      'ck_wallets_address',
      sql`
        ${table.address} LIKE '0x%'
        AND length(${table.address}) = 42
        AND substr(${table.address}, 3) NOT GLOB '*[^0-9A-Fa-f]*'
      `,
    ),

    normalizedAddressCheck: check(
      'ck_wallets_address_normalized',
      sql`
        ${table.addressNormalized} LIKE '0x%'
        AND length(${table.addressNormalized}) = 42
        AND substr(${table.addressNormalized}, 3)
            NOT GLOB '*[^0-9A-Fa-f]*'
      `,
    ),

    normalizedLowercaseCheck: check(
      'ck_wallets_address_normalized_lowercase',
      sql`
        ${table.addressNormalized}
        = lower(${table.addressNormalized})
      `,
    ),

    normalizedMatchesAddressCheck: check(
      'ck_wallets_address_normalized_matches',
      sql`
        ${table.addressNormalized}
        = lower(${table.address})
      `,
    ),

    /**
     * Verified wallet requires verification timestamp, method, and lastOwnershipVerifiedAt.
     */
    verifiedStateCheck: check(
      'ck_wallets_verified_state',
      sql`
        ${table.verificationStatus} != 'verified'
        OR (
          ${table.verifiedAt} IS NOT NULL
          AND ${table.verificationMethod} IS NOT NULL
          AND ${table.lastOwnershipVerifiedAt} IS NOT NULL
        )
      `,
    ),

    /**
     * Rejected wallet must not be marked verified.
     */
    rejectedVerificationCheck: check(
      'ck_wallets_rejected_verification',
      sql`
        ${table.verificationStatus} != 'rejected'
        OR ${table.verifiedAt} IS NULL
      `,
    ),

    /**
     * Revoked wallet requires revocation timestamp.
     */
    revokedAtCheck: check(
      'ck_wallets_revoked_at',
      sql`
        ${table.status} != 'revoked'
        OR ${table.revokedAt} IS NOT NULL
      `,
    ),

    /**
     * Suspended wallet requires suspension timestamp.
     */
    suspendedAtCheck: check(
      'ck_wallets_suspended_at',
      sql`
        ${table.status} != 'suspended'
        OR ${table.suspendedAt} IS NOT NULL
      `,
    ),

    /**
     * Unlinked state is for external wallets only.
     */
    unlinkedStateCheck: check(
      'ck_wallets_unlinked_state',
      sql`
        ${table.status} != 'unlinked'
        OR (
          ${table.provenance} = 'external'
          AND ${table.isPrimary} = false
          AND ${table.unlinkedAt} IS NOT NULL
        )
      `,
    ),

    /**
     * Internal wallets cannot be unlinked.
     */
    internalUnlinkedCheck: check(
      'ck_wallets_internal_unlinked',
      sql`
        ${table.provenance} != 'internal'
        OR ${table.status} != 'unlinked'
      `,
    ),

    verifiedAfterLinkedCheck: check(
      'ck_wallets_verified_after_linked',
      sql`
        ${table.verifiedAt} IS NULL
        OR ${table.verifiedAt} >= ${table.linkedAt}
      `,
    ),

    suspendedAfterLinkedCheck: check(
      'ck_wallets_suspended_after_linked',
      sql`
        ${table.suspendedAt} IS NULL
        OR ${table.suspendedAt} >= ${table.linkedAt}
      `,
    ),

    revokedAfterLinkedCheck: check(
      'ck_wallets_revoked_after_linked',
      sql`
        ${table.revokedAt} IS NULL
        OR ${table.revokedAt} >= ${table.linkedAt}
      `,
    ),

    unlinkedAfterLinkedCheck: check(
      'ck_wallets_unlinked_after_linked',
      sql`
        ${table.unlinkedAt} IS NULL
        OR ${table.unlinkedAt} >= ${table.linkedAt}
      `,
    ),


    provenanceCheck: check(
      'ck_wallets_provenance',
      sql`
        ${table.provenance} IN ('internal', 'external')
      `,
    ),

    controlModeCheck: check(
      'ck_wallets_control_mode',
      sql`
        (
          ${table.provenance} = 'internal'
          AND ${table.walletType} = 'eoa'
          AND ${table.controlMode} = 'platform_key'
        )
        OR (
          ${table.provenance} = 'external'
          AND ${table.walletType} = 'eoa'
          AND ${table.controlMode} = 'external_user'
        )
        OR (
          ${table.walletType} = 'smart_contract'
          AND ${table.controlMode} = 'contract_controller'
        )
      `,
    ),

    smartContractControllerCheck: check(
      'ck_wallets_smart_contract_controller',
      sql`
        ${table.walletType} != 'smart_contract'
        OR ${table.controllerWalletId} IS NOT NULL
      `,
    ),
  }),
);

/* ============================================================================
 * 4. WEB3 TRANSACTIONS
 * ========================================================================== */

export const web3Transactions = sqliteTable(
  'web3_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    networkId: integer('network_id')
      .notNull()
      .references(() => web3Networks.id, {
        onDelete: 'restrict',
      }),

    walletId: integer('wallet_id')
      .notNull()
      .references(() => wallets.id, {
        onDelete: 'restrict',
      }),

    /**
     * Optional until signing/submission.
     */
    txHash: text('tx_hash'),

    /**
     * Technical operation type.
     */
    transactionType: text('transaction_type', {
      enum: [
        'native_transfer',
        'token_transfer',
        'contract_call',
        'contract_deployment',
        'other',
      ],
    }).notNull(),

    /**
     * EVM sender.
     */
    fromAddress: text('from_address').notNull(),

    /**
     * NULL is valid for contract deployment.
     */
    toAddress: text('to_address'),

    /**
     * EVM nonce.
     *
     * Historical transactions MAY share the same nonce because of
     * replacement.
     */
    nonce: integer('nonce'),

    /**
     * Native asset value in base units.
     */
    valueBaseUnits: text('value_base_units')
      .notNull()
      .default('0'),

    /**
     * Raw transaction calldata.
     */
    data: text('data'),

    /**
     * Legacy gas model.
     */
    gasLimit: text('gas_limit'),
    gasPrice: text('gas_price'),

    /**
     * EIP-1559 gas model.
     */
    maxFeePerGas: text('max_fee_per_gas'),
    maxPriorityFeePerGas: text('max_priority_fee_per_gas'),

    /**
     * Receipt gas information.
     */
    gasUsed: text('gas_used'),
    effectiveGasPrice: text('effective_gas_price'),

    /**
     * Block inclusion.
     */
    blockNumber: integer('block_number'),
    blockHash: text('block_hash'),

    /**
     * Blockchain transaction lifecycle.
     */
    status: text('status', {
      enum: [
        'created',
        'signing',
        'signed',
        'submitted',
        'pending',
        'confirmed',
        'failed',
        'dropped',
        'replaced',
      ],
    })
      .notNull()
      .default('created'),

    /**
     * Actual receipt execution result.
     *
     * success  = execution succeeded
     * reverted = transaction was mined but reverted
     */
    receiptStatus: text('receipt_status', {
      enum: ['success', 'reverted'],
    }),

    /**
     * Diagnosis code for failed/dropped/replaced transactions.
     */
    failureCode: text('failure_code'),
    failureReason: text('failure_reason'),

    /**
     * Replacement lineage.
     *
     * If transaction B replaces transaction A:
     *
     * B.replacementOfTransactionId = A.id
     */
    replacementOfTransactionId: integer(
      'replacement_of_transaction_id',
    ),

    submittedAt: integer('submitted_at', {
      mode: 'timestamp',
    }),

    confirmedAt: integer('confirmed_at', {
      mode: 'timestamp',
    }),

    failedAt: integer('failed_at', {
      mode: 'timestamp',
    }),

    version: integer('version').notNull().default(1),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', {
      mode: 'timestamp',
    })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    /**
     * A blockchain transaction hash is unique per network.
     */
    txHashUnique: uniqueIndex(
      'uq_web3_transactions_network_hash',
    ).on(
      table.networkId,
      table.txHash,
    ),

    /**
     * IMPORTANT:
     *
     * We intentionally DO NOT create:
     *
     *   UNIQUE(walletId, nonce)
     *
     * because replacements legitimately reuse a nonce.
     *
     * This partial unique index only reserves a nonce while a transaction
     * is actively occupying it.
     */
    activeWalletNonceUnique: uniqueIndex(
      'uq_web3_transactions_active_wallet_nonce',
    )
      .on(
        table.walletId,
        table.nonce,
      )
      .where(
        sql`
          ${table.nonce} IS NOT NULL
          AND ${table.status} IN (
            'created',
            'signing',
            'signed',
            'submitted',
            'pending'
          )
        `,
      ),

    replacementFk: foreignKey({
      columns: [table.replacementOfTransactionId],
      foreignColumns: [table.id],
      name: 'fk_web3_transactions_replacement',
    }).onDelete('restrict'),


    walletIdx: index(
      'idx_web3_transactions_wallet',
    ).on(
      table.walletId,
      table.createdAt,
    ),

    walletNonceIdx: index(
      'idx_web3_transactions_wallet_nonce',
    ).on(
      table.walletId,
      table.nonce,
    ),

    networkStatusIdx: index(
      'idx_web3_transactions_network_status',
    ).on(
      table.networkId,
      table.status,
      table.createdAt,
    ),

    statusIdx: index(
      'idx_web3_transactions_status',
    ).on(table.status),

    replacementIdx: index(
      'idx_web3_transactions_replacement',
    ).on(
      table.replacementOfTransactionId,
    ),

    blockIdx: index(
      'idx_web3_transactions_block',
    ).on(
      table.networkId,
      table.blockNumber,
    ),

    nonceCheck: check(
      'ck_web3_transactions_nonce',
      sql`
        ${table.nonce} IS NULL
        OR ${table.nonce} >= 0
      `,
    ),

    blockNumberCheck: check(
      'ck_web3_transactions_block_number',
      sql`
        ${table.blockNumber} IS NULL
        OR ${table.blockNumber} >= 0
      `,
    ),

    /**
     * 0x + 64 hexadecimal characters.
     */
    txHashCheck: check(
      'ck_web3_transactions_hash',
      sql`
        ${table.txHash} IS NULL
        OR (
          ${table.txHash} LIKE '0x%'
          AND length(${table.txHash}) = 66
          AND substr(${table.txHash}, 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      `,
    ),

    fromAddressCheck: check(
      'ck_web3_transactions_from_address',
      sql`
        ${table.fromAddress} LIKE '0x%'
        AND length(${table.fromAddress}) = 42
        AND substr(${table.fromAddress}, 3)
            NOT GLOB '*[^0-9A-Fa-f]*'
      `,
    ),

    toAddressCheck: check(
      'ck_web3_transactions_to_address',
      sql`
        ${table.toAddress} IS NULL
        OR (
          ${table.toAddress} LIKE '0x%'
          AND length(${table.toAddress}) = 42
          AND substr(${table.toAddress}, 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      `,
    ),

    dataCheck: check(
      'ck_web3_transactions_data',
      sql`
        ${table.data} IS NULL
        OR (
          ${table.data} LIKE '0x%'
          AND length(${table.data}) >= 2
          AND (length(${table.data}) - 2) % 2 = 0
          AND substr(${table.data}, 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      `,
    ),

    /**
     * Canonical unsigned integer:
     *
     * 0
     * 1
     * 100
     *
     * No:
     * - negative values
     * - leading zeroes
     * - decimals
     * - text garbage
     */
    valueBaseUnitsCheck: check(
      'ck_web3_transactions_value_base_units',
      sql`
        ${table.valueBaseUnits} <> ''
        AND ltrim(
          ${table.valueBaseUnits},
          '0123456789'
        ) = ''
        AND (
          ${table.valueBaseUnits} = '0'
          OR ltrim(
            ${table.valueBaseUnits},
            '0'
          ) = ${table.valueBaseUnits}
        )
      `,
    ),

    gasLimitCheck: check(
      'ck_web3_transactions_gas_limit',
      sql`
        ${table.gasLimit} IS NULL
        OR (
          ${table.gasLimit} <> ''
          AND ltrim(
            ${table.gasLimit},
            '0123456789'
          ) = ''
          AND (
            ${table.gasLimit} = '0'
            OR ltrim(
              ${table.gasLimit},
              '0'
            ) = ${table.gasLimit}
          )
        )
      `,
    ),

    gasPriceCheck: check(
      'ck_web3_transactions_gas_price',
      sql`
        ${table.gasPrice} IS NULL
        OR (
          ${table.gasPrice} <> ''
          AND ltrim(
            ${table.gasPrice},
            '0123456789'
          ) = ''
          AND (
            ${table.gasPrice} = '0'
            OR ltrim(
              ${table.gasPrice},
              '0'
            ) = ${table.gasPrice}
          )
        )
      `,
    ),

    maxFeePerGasCheck: check(
      'ck_web3_transactions_max_fee_per_gas',
      sql`
        ${table.maxFeePerGas} IS NULL
        OR (
          ${table.maxFeePerGas} <> ''
          AND ltrim(
            ${table.maxFeePerGas},
            '0123456789'
          ) = ''
          AND (
            ${table.maxFeePerGas} = '0'
            OR ltrim(
              ${table.maxFeePerGas},
              '0'
            ) = ${table.maxFeePerGas}
          )
        )
      `,
    ),

    maxPriorityFeePerGasCheck: check(
      'ck_web3_transactions_max_priority_fee_per_gas',
      sql`
        ${table.maxPriorityFeePerGas} IS NULL
        OR (
          ${table.maxPriorityFeePerGas} <> ''
          AND ltrim(
            ${table.maxPriorityFeePerGas},
            '0123456789'
          ) = ''
          AND (
            ${table.maxPriorityFeePerGas} = '0'
            OR ltrim(
              ${table.maxPriorityFeePerGas},
              '0'
            ) = ${table.maxPriorityFeePerGas}
          )
        )
      `,
    ),

    gasUsedCheck: check(
      'ck_web3_transactions_gas_used',
      sql`
        ${table.gasUsed} IS NULL
        OR (
          ${table.gasUsed} <> ''
          AND ltrim(
            ${table.gasUsed},
            '0123456789'
          ) = ''
          AND (
            ${table.gasUsed} = '0'
            OR ltrim(
              ${table.gasUsed},
              '0'
            ) = ${table.gasUsed}
          )
        )
      `,
    ),

    effectiveGasPriceCheck: check(
      'ck_web3_transactions_effective_gas_price',
      sql`
        ${table.effectiveGasPrice} IS NULL
        OR (
          ${table.effectiveGasPrice} <> ''
          AND ltrim(
            ${table.effectiveGasPrice},
            '0123456789'
          ) = ''
          AND (
            ${table.effectiveGasPrice} = '0'
            OR ltrim(
              ${table.effectiveGasPrice},
              '0'
            ) = ${table.effectiveGasPrice}
          )
        )
      `,
    ),

    /**
     * EIP-1559 requires maxFeePerGas whenever maxPriorityFeePerGas exists.
     *
     * The numerical relation:
     *
     *   maxPriorityFeePerGas <= maxFeePerGas
     *
     * must also be validated in application/domain code using BigInt,
     * because arbitrary-size integer strings cannot safely be compared with
     * SQLite's native numeric operators.
     */
    maxPriorityRequiresMaxFeeCheck: check(
      'ck_web3_transactions_priority_requires_max_fee',
      sql`
        ${table.maxPriorityFeePerGas} IS NULL
        OR ${table.maxFeePerGas} IS NOT NULL
      `,
    ),

    /**
     * Submitted/live transactions must have a hash.
     */
    submittedHashCheck: check(
      'ck_web3_transactions_submitted_hash',
      sql`
        ${table.status} NOT IN (
          'submitted',
          'pending',
          'confirmed',
          'dropped',
          'replaced'
        )
        OR ${table.txHash} IS NOT NULL
      `,
    ),

    /**
     * Signed/live transactions need nonce.
     */
    signedNonceCheck: check(
      'ck_web3_transactions_signed_nonce',
      sql`
        ${table.status} NOT IN (
          'signed',
          'submitted',
          'pending',
          'confirmed',
          'dropped',
          'replaced'
        )
        OR ${table.nonce} IS NOT NULL
      `,
    ),

    /**
     * Submitted/live transactions require submittedAt.
     */
    submittedAtCheck: check(
      'ck_web3_transactions_submitted_at',
      sql`
        ${table.status} NOT IN (
          'submitted',
          'pending',
          'confirmed',
          'dropped',
          'replaced'
        )
        OR ${table.submittedAt} IS NOT NULL
      `,
    ),

    /**
     * Confirmed transaction must have complete chain/receipt data.
     */
    confirmedStateCheck: check(
      'ck_web3_transactions_confirmed_state',
      sql`
        ${table.status} != 'confirmed'
        OR (
          ${table.confirmedAt} IS NOT NULL
          AND ${table.blockNumber} IS NOT NULL
          AND ${table.blockHash} IS NOT NULL
          AND ${table.receiptStatus} IS NOT NULL
        )
      `,
    ),

    blockHashCheck: check(
      'ck_web3_transactions_block_hash',
      sql`
        ${table.blockHash} IS NULL
        OR (
          ${table.blockHash} LIKE '0x%'
          AND length(${table.blockHash}) = 66
          AND substr(${table.blockHash}, 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      `,
    ),

    /**
     * Failed transaction requires failure timestamp.
     */
    failedStateCheck: check(
      'ck_web3_transactions_failed_state',
      sql`
        ${table.status} != 'failed'
        OR ${table.failedAt} IS NOT NULL
      `,
    ),

    /**
     * A replacement cannot point to itself.
     */
    replacementSelfCheck: check(
      'ck_web3_transactions_replacement_self',
      sql`
        ${table.replacementOfTransactionId} IS NULL
        OR ${table.replacementOfTransactionId} != ${table.id}
      `,
    ),

    /**
     * Replacement must have nonce and cannot be the initial transaction.
     */
    replacementStateCheck: check(
      'ck_web3_transactions_replacement_state',
      sql`
        ${table.status} != 'replaced'
        OR (
          ${table.nonce} IS NOT NULL
          AND ${table.replacementOfTransactionId} IS NOT NULL
        )
      `,
    ),

    versionCheck: check(
      'ck_web3_transactions_version',
      sql`${table.version} > 0`,
    ),
  }),
);
