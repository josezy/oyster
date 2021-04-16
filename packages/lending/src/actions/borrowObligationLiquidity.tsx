import {
  actions,
  contexts,
  LEND_HOST_FEE_ADDRESS,
  LENDING_PROGRAM_ID,
  models,
  notify,
  ParsedAccount,
  TokenAccount,
  toLamports,
} from '@oyster/common';
import { AccountLayout, MintInfo } from '@solana/spl-token';
import {
  Account,
  Connection,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  BorrowAmountType,
  borrowObligationLiquidityInstruction,
  initObligationInstruction,
  Obligation,
  ObligationLayout,
  refreshReserveInstruction,
  Reserve,
} from '../models';
import { createObligation } from './createObligation';

const { approve } = models;
const { cache, MintParser } = contexts.Accounts;
const { sendTransaction } = contexts.Connection;
const {
  createTempMemoryAccount,
  createUninitializedAccount,
  createUninitializedMint,
  ensureSplAccount,
  findOrCreateAccountByMint,
} = actions;

// @FIXME
export const borrowObligationLiquidity = async (
  connection: Connection,
  wallet: any,
  from: TokenAccount,
  amount: number,
  borrowReserve: ParsedAccount<Reserve>,
  depositReserve: ParsedAccount<Reserve>,
  existingObligation: ParsedAccount<Obligation>,

  obligationAccount?: PublicKey,
) => {
  notify({
    message: 'Borrowing funds...',
    description: 'Please review transactions to approve.',
    type: 'warn',
  });

  let signers: Account[] = [];
  let instructions: TransactionInstruction[] = [];
  let cleanupInstructions: TransactionInstruction[] = [];
  let finalCleanupInstructions: TransactionInstruction[] = [];

  const [lendingMarketAuthority] = await PublicKey.findProgramAddress(
    [depositReserve.info.lendingMarket.toBuffer()],
    LENDING_PROGRAM_ID,
  );

  const accountRentExempt = await connection.getMinimumBalanceForRentExemption(
    AccountLayout.span,
  );

  const obligation = existingObligation
    ? existingObligation.pubkey
    : createObligation(
        instructions,
        wallet.publicKey,
        await connection.getMinimumBalanceForRentExemption(
          ObligationLayout.span,
        ),
        signers,
      );

  if (!obligationAccount) {
    instructions.push(
      initObligationInstruction(
        obligation,
        depositReserve.info.lendingMarket,
        wallet.publicKey,
      ),
    );
  }

  // Creates host fee account if it doesn't exsist
  let hostFeeReceiver = LEND_HOST_FEE_ADDRESS
    ? findOrCreateAccountByMint(
        wallet.publicKey,
        LEND_HOST_FEE_ADDRESS,
        instructions,
        [],
        accountRentExempt,
        depositReserve.info.collateral.mint,
        signers,
      )
    : undefined;

  let amountLamports: number = 0;
  let fromLamports: number = 0;
  if (amountType === BorrowAmountType.LiquidityBorrowAmount) {
    // approve max transfer
    // TODO: improve contrain by using dex market data
    const approvedAmount = from.info.amount.toNumber();

    fromLamports = approvedAmount - accountRentExempt;

    const mint = (await cache.query(
      connection,
      borrowReserve.info.liquidity.mint,
      MintParser,
    )) as ParsedAccount<MintInfo>;

    amountLamports = toLamports(amount, mint?.info);
  } else if (amountType === BorrowAmountType.CollateralDepositAmount) {
    const mint = (await cache.query(
      connection,
      depositReserve.info.collateral.mint,
      MintParser,
    )) as ParsedAccount<MintInfo>;
    amountLamports = toLamports(amount, mint?.info);
    fromLamports = amountLamports;
  }

  const sourceLiquidity = ensureSplAccount(
    instructions,
    finalCleanupInstructions,
    from,
    wallet.publicKey,
    fromLamports + accountRentExempt,
    signers,
  );

  let destinationLiquidity = await findOrCreateAccountByMint(
    wallet.publicKey,
    wallet.publicKey,
    instructions,
    finalCleanupInstructions,
    accountRentExempt,
    borrowReserve.info.liquidity.mint,
    signers,
  );

  if (instructions.length > 0) {
    // create all accounts in one transaction
    let { txid }  = await sendTransaction(connection, wallet, instructions, [
      ...signers,
    ]);

    notify({
      message: 'Obligation accounts created',
      description: `Transaction ${txid}`,
      type: 'success',
    });
  }

  notify({
    message: 'Borrowing funds...',
    description: 'Please review transactions to approve.',
    type: 'warn',
  });

  signers = [];
  instructions = [];
  cleanupInstructions = [...finalCleanupInstructions];

  instructions.push(
    // @FIXME: aggregator needed
    refreshReserveInstruction(depositReserve.pubkey),
    refreshReserveInstruction(borrowReserve.pubkey),
  );
  // borrow
  instructions.push(
    borrowObligationLiquidityInstruction(
      amountLamports,
      borrowReserve.info.liquidity.supply,
      destinationLiquidity,
      borrowReserve.pubkey,
      borrowReserve.info.liquidity.feeReceiver,
      obligation,
      borrowReserve.info.lendingMarket,
      lendingMarketAuthority,
      // @FIXME: obligation owner
      obligationOwner,
      hostFeeReceiver,
    ),
  );
  try {
    let { txid }  = await sendTransaction(
      connection,
      wallet,
      instructions.concat(cleanupInstructions),
      signers,
      true,
    );

    notify({
      message: 'Funds borrowed.',
      type: 'success',
      description: `Transaction - ${txid}`,
    });
  } catch (ex) {
    console.error(ex);
    throw new Error();
  }
};
