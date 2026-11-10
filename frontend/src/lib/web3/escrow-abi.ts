// T06 Solidity 0.8.30 ABI; kept in sync by local contract integration.
export const escrowAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'token_',
        type: 'address',
        internalType: 'address'
      },
      {
        name: 'admin_',
        type: 'address',
        internalType: 'address'
      },
      {
        name: 'arbitrator_',
        type: 'address',
        internalType: 'address'
      }
    ],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'ACCEPTANCE_SECONDS',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'DELIVERY_SECONDS',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'DELIVERY_TYPEHASH',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'DISPUTE_SECONDS',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'PAYMENT_SECONDS',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'PAYMENT_TYPEHASH',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'accept',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'administrator',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'arbitrator',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'configureSigner',
    inputs: [
      {
        name: 'kind',
        type: 'uint8',
        internalType: 'uint8'
      },
      {
        name: 'keyId',
        type: 'bytes32',
        internalType: 'bytes32'
      },
      {
        name: 'account',
        type: 'address',
        internalType: 'address'
      },
      {
        name: 'validFrom',
        type: 'uint256',
        internalType: 'uint256'
      },
      {
        name: 'validUntil',
        type: 'uint256',
        internalType: 'uint256'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'consumedCredentials',
    inputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'consumedIntents',
    inputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'deliveryDigest',
    inputs: [
      {
        name: 'p',
        type: 'tuple',
        internalType: 'struct BazaarEscrow.DeliveryPermit',
        components: [
          {
            name: 'schemaVersion',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'credentialId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'orderId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'seller',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'deliveryVersion',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'manifestCommitment',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'issuedAt',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'expiresAt',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'signerKeyId',
            type: 'bytes32',
            internalType: 'bytes32'
          }
        ]
      }
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      {
        name: 'p',
        type: 'tuple',
        internalType: 'struct BazaarEscrow.PaymentPermit',
        components: [
          {
            name: 'schemaVersion',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'orderId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'stockId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'stockGeneration',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'previousOrderId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'buyer',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'refundAddress',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'seller',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'token',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'amountAtoms',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'commitmentHash',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'intentId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'issuedAt',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'payDeadline',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'signerKeyId',
            type: 'bytes32',
            internalType: 'bytes32'
          }
        ]
      },
      {
        name: 'signature',
        type: 'bytes',
        internalType: 'bytes'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'depositPaused',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'eip712Domain',
    inputs: [],
    outputs: [
      {
        name: 'fields',
        type: 'bytes1',
        internalType: 'bytes1'
      },
      {
        name: 'name',
        type: 'string',
        internalType: 'string'
      },
      {
        name: 'version',
        type: 'string',
        internalType: 'string'
      },
      {
        name: 'chainId',
        type: 'uint256',
        internalType: 'uint256'
      },
      {
        name: 'verifyingContract',
        type: 'address',
        internalType: 'address'
      },
      {
        name: 'salt',
        type: 'bytes32',
        internalType: 'bytes32'
      },
      {
        name: 'extensions',
        type: 'uint256[]',
        internalType: 'uint256[]'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'openDispute',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32'
      },
      {
        name: 'evidenceCommitment',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'order',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct BazaarEscrow.Order',
        components: [
          {
            name: 'state',
            type: 'uint8',
            internalType: 'enum BazaarEscrow.State'
          },
          {
            name: 'buyer',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'refundAddress',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'seller',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'amountAtoms',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'stockId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'generation',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'fundedAt',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'deliveredAt',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'disputedAt',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'credentialId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'deliveryVersion',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'manifestCommitment',
            type: 'bytes32',
            internalType: 'bytes32'
          }
        ]
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'orderTermsDigest',
    inputs: [
      {
        name: 'p',
        type: 'tuple',
        internalType: 'struct BazaarEscrow.PaymentPermit',
        components: [
          {
            name: 'schemaVersion',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'orderId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'stockId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'stockGeneration',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'previousOrderId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'buyer',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'refundAddress',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'seller',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'token',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'amountAtoms',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'commitmentHash',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'intentId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'issuedAt',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'payDeadline',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'signerKeyId',
            type: 'bytes32',
            internalType: 'bytes32'
          }
        ]
      }
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    stateMutability: 'pure'
  },
  {
    type: 'function',
    name: 'orderTermsHash',
    inputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'orders',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct BazaarEscrow.Order',
        components: [
          {
            name: 'state',
            type: 'uint8',
            internalType: 'enum BazaarEscrow.State'
          },
          {
            name: 'buyer',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'refundAddress',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'seller',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'amountAtoms',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'stockId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'generation',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'fundedAt',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'deliveredAt',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'disputedAt',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'credentialId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'deliveryVersion',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'manifestCommitment',
            type: 'bytes32',
            internalType: 'bytes32'
          }
        ]
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'outstanding',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'paymentDigest',
    inputs: [
      {
        name: 'p',
        type: 'tuple',
        internalType: 'struct BazaarEscrow.PaymentPermit',
        components: [
          {
            name: 'schemaVersion',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'orderId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'stockId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'stockGeneration',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'previousOrderId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'buyer',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'refundAddress',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'seller',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'token',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'amountAtoms',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'commitmentHash',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'intentId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'issuedAt',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'payDeadline',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'signerKeyId',
            type: 'bytes32',
            internalType: 'bytes32'
          }
        ]
      }
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'refundDisputeTimeout',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'refundUndelivered',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'registerDelivery',
    inputs: [
      {
        name: 'p',
        type: 'tuple',
        internalType: 'struct BazaarEscrow.DeliveryPermit',
        components: [
          {
            name: 'schemaVersion',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'credentialId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'orderId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'seller',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'deliveryVersion',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'manifestCommitment',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'issuedAt',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'expiresAt',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'signerKeyId',
            type: 'bytes32',
            internalType: 'bytes32'
          }
        ]
      },
      {
        name: 'signature',
        type: 'bytes',
        internalType: 'bytes'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'resolveDispute',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32'
      },
      {
        name: 'refund',
        type: 'bool',
        internalType: 'bool'
      },
      {
        name: 'reasonCommitment',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'revokeIntent',
    inputs: [
      {
        name: 'p',
        type: 'tuple',
        internalType: 'struct BazaarEscrow.PaymentPermit',
        components: [
          {
            name: 'schemaVersion',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'orderId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'stockId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'stockGeneration',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'previousOrderId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'buyer',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'refundAddress',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'seller',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'token',
            type: 'address',
            internalType: 'address'
          },
          {
            name: 'amountAtoms',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'commitmentHash',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'intentId',
            type: 'bytes32',
            internalType: 'bytes32'
          },
          {
            name: 'issuedAt',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'payDeadline',
            type: 'uint256',
            internalType: 'uint256'
          },
          {
            name: 'signerKeyId',
            type: 'bytes32',
            internalType: 'bytes32'
          }
        ]
      },
      {
        name: 'signature',
        type: 'bytes',
        internalType: 'bytes'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'revokeSigner',
    inputs: [
      {
        name: 'kind',
        type: 'uint8',
        internalType: 'uint8'
      },
      {
        name: 'keyId',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'revokedIntents',
    inputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'setDepositPaused',
    inputs: [
      {
        name: 'paused',
        type: 'bool',
        internalType: 'bool'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'settleExpired',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'signers',
    inputs: [
      {
        name: '',
        type: 'uint8',
        internalType: 'uint8'
      },
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [
      {
        name: 'account',
        type: 'address',
        internalType: 'address'
      },
      {
        name: 'validFrom',
        type: 'uint256',
        internalType: 'uint256'
      },
      {
        name: 'validUntil',
        type: 'uint256',
        internalType: 'uint256'
      },
      {
        name: 'revoked',
        type: 'bool',
        internalType: 'bool'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'stockGeneration',
    inputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'stockOccupant',
    inputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'token',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract IERC20'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'totalDeposited',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'totalPaid',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256'
      }
    ],
    stateMutability: 'view'
  },
  {
    type: 'event',
    name: 'DeliveryRegistered',
    inputs: [
      {
        name: 'orderId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32'
      },
      {
        name: 'credentialId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32'
      },
      {
        name: 'deliveryVersion',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32'
      },
      {
        name: 'manifestCommitment',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32'
      },
      {
        name: 'seller',
        type: 'address',
        indexed: false,
        internalType: 'address'
      },
      {
        name: 'timestamp',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      },
      {
        name: 'acceptanceDeadline',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      }
    ],
    anonymous: false
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      {
        name: 'orderId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32'
      },
      {
        name: 'intentId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32'
      },
      {
        name: 'stockId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32'
      },
      {
        name: 'generation',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      },
      {
        name: 'buyer',
        type: 'address',
        indexed: false,
        internalType: 'address'
      },
      {
        name: 'refundAddress',
        type: 'address',
        indexed: false,
        internalType: 'address'
      },
      {
        name: 'seller',
        type: 'address',
        indexed: false,
        internalType: 'address'
      },
      {
        name: 'token',
        type: 'address',
        indexed: false,
        internalType: 'address'
      },
      {
        name: 'amountAtoms',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      },
      {
        name: 'timestamp',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      },
      {
        name: 'deliveryDeadline',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      },
      {
        name: 'termsHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32'
      }
    ],
    anonymous: false
  },
  {
    type: 'event',
    name: 'DisputeOpened',
    inputs: [
      {
        name: 'orderId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32'
      },
      {
        name: 'evidenceCommitment',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32'
      },
      {
        name: 'buyer',
        type: 'address',
        indexed: false,
        internalType: 'address'
      },
      {
        name: 'timestamp',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      },
      {
        name: 'disputeDeadline',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      }
    ],
    anonymous: false
  },
  {
    type: 'event',
    name: 'EIP712DomainChanged',
    inputs: [],
    anonymous: false
  },
  {
    type: 'event',
    name: 'IntentRevoked',
    inputs: [
      {
        name: 'orderId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32'
      },
      {
        name: 'intentId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32'
      },
      {
        name: 'stockId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32'
      },
      {
        name: 'buyer',
        type: 'address',
        indexed: false,
        internalType: 'address'
      },
      {
        name: 'timestamp',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      },
      {
        name: 'payDeadline',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      },
      {
        name: 'termsHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32'
      }
    ],
    anonymous: false
  },
  {
    type: 'event',
    name: 'PauseChanged',
    inputs: [
      {
        name: 'paused',
        type: 'bool',
        indexed: false,
        internalType: 'bool'
      }
    ],
    anonymous: false
  },
  {
    type: 'event',
    name: 'Refunded',
    inputs: [
      {
        name: 'orderId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32'
      },
      {
        name: 'recipient',
        type: 'address',
        indexed: true,
        internalType: 'address'
      },
      {
        name: 'token',
        type: 'address',
        indexed: false,
        internalType: 'address'
      },
      {
        name: 'amountAtoms',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      },
      {
        name: 'timestamp',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      },
      {
        name: 'reason',
        type: 'uint8',
        indexed: false,
        internalType: 'enum BazaarEscrow.Reason'
      },
      {
        name: 'reasonCommitment',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32'
      }
    ],
    anonymous: false
  },
  {
    type: 'event',
    name: 'Released',
    inputs: [
      {
        name: 'orderId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32'
      },
      {
        name: 'recipient',
        type: 'address',
        indexed: true,
        internalType: 'address'
      },
      {
        name: 'token',
        type: 'address',
        indexed: false,
        internalType: 'address'
      },
      {
        name: 'amountAtoms',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      },
      {
        name: 'timestamp',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      },
      {
        name: 'reason',
        type: 'uint8',
        indexed: false,
        internalType: 'enum BazaarEscrow.Reason'
      },
      {
        name: 'reasonCommitment',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32'
      }
    ],
    anonymous: false
  },
  {
    type: 'event',
    name: 'SignerChanged',
    inputs: [
      {
        name: 'kind',
        type: 'uint8',
        indexed: true,
        internalType: 'uint8'
      },
      {
        name: 'keyId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32'
      },
      {
        name: 'account',
        type: 'address',
        indexed: false,
        internalType: 'address'
      },
      {
        name: 'validFrom',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      },
      {
        name: 'validUntil',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256'
      }
    ],
    anonymous: false
  },
  {
    type: 'event',
    name: 'SignerRevoked',
    inputs: [
      {
        name: 'kind',
        type: 'uint8',
        indexed: true,
        internalType: 'uint8'
      },
      {
        name: 'keyId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32'
      }
    ],
    anonymous: false
  },
  {
    type: 'error',
    name: 'Deadline',
    inputs: []
  },
  {
    type: 'error',
    name: 'ECDSAInvalidSignature',
    inputs: []
  },
  {
    type: 'error',
    name: 'ECDSAInvalidSignatureLength',
    inputs: [
      {
        name: 'length',
        type: 'uint256',
        internalType: 'uint256'
      }
    ]
  },
  {
    type: 'error',
    name: 'ECDSAInvalidSignatureS',
    inputs: [
      {
        name: 's',
        type: 'bytes32',
        internalType: 'bytes32'
      }
    ]
  },
  {
    type: 'error',
    name: 'Invalid',
    inputs: []
  },
  {
    type: 'error',
    name: 'InvalidShortString',
    inputs: []
  },
  {
    type: 'error',
    name: 'InvalidSignature',
    inputs: []
  },
  {
    type: 'error',
    name: 'ReentrancyGuardReentrantCall',
    inputs: []
  },
  {
    type: 'error',
    name: 'SafeERC20FailedOperation',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address'
      }
    ]
  },
  {
    type: 'error',
    name: 'StringTooLong',
    inputs: [
      {
        name: 'str',
        type: 'string',
        internalType: 'string'
      }
    ]
  },
  {
    type: 'error',
    name: 'Unauthorized',
    inputs: []
  },
  {
    type: 'error',
    name: 'WrongState',
    inputs: []
  }
] as const
