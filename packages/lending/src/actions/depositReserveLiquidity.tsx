import {
  actions,
  contexts,
  LENDING_PROGRAM_ID,
  models,
  notify,
  TokenAccount,
} from '@oyster/common';
import { AccountLayout } from '@solana/spl-token';
import {
  Account,
  Connection,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  depositReserveLiquidityInstruction,
  initReserveInstruction,
  refreshReserveInstruction,
  Reserve,
} from '../models';

const { sendTransaction } = contexts.Connection;
const {
  createUninitializedAccount,
  ensureSplAccount,
  findOrCreateAccountByMint,
} = actions;
const { approve } = models;

// @FIXME
export const depositReserveLiquidity = async (
  from: TokenAccount,
  amountLamports: number,
  reserve: Reserve,
  reserveAddress: PublicKey,
  connection: Connection,
  wallet: any,
) => {
  notify({
    message: 'Depositing funds...',
    description: 'Please review transactions to approve.',
    type: 'warn',
  });

  const isInitalized = true; // TODO: finish reserve init

  // user from account
  const signers: Account[] = [];
  const instructions: TransactionInstruction[] = [];
  const cleanupInstructions: TransactionInstruction[] = [];

  const accountRentExempt = await connection.getMinimumBalanceForRentExemption(
    AccountLayout.span,
  );

  const [lendingMarketAuthority] = await PublicKey.findProgramAddress(
    [reserve.lendingMarket.toBuffer()], // which account should be authority
    LENDING_PROGRAM_ID,
  );

  const sourceLiquidityAccount = ensureSplAccount(
    instructions,
    cleanupInstructions,
    from,
    wallet.publicKey,
    amountLamports + accountRentExempt,
    signers,
  );

  // create approval for transfer transactions
  const transferAuthority = approve(
    instructions,
    cleanupInstructions,
    sourceLiquidityAccount,
    wallet.publicKey,
    amountLamports,
  );

  signers.push(transferAuthority);

  let destinationCollateralAccount: PublicKey;
  if (isInitalized) {
    // get destination account
    destinationCollateralAccount = await findOrCreateAccountByMint(
      wallet.publicKey,
      wallet.publicKey,
      instructions,
      cleanupInstructions,
      accountRentExempt,
      reserve.collateral.mint,
      signers,
    );
  } else {
    destinationCollateralAccount = createUninitializedAccount(
      instructions,
      wallet.publicKey,
      accountRentExempt,
      signers,
    );
  }

  if (isInitalized) {
    // @FIXME: aggregator needed
    instructions.push(refreshReserveInstruction(reserveAddress));

    // deposit
    instructions.push(
      depositReserveLiquidityInstruction(
        amountLamports,
        sourceLiquidityAccount,
        destinationCollateralAccount,
        reserveAddress,
        reserve.liquidity.supply,
        reserve.collateral.mint,
        reserve.lendingMarket,
        lendingMarketAuthority,
        transferAuthority.publicKey,
      ),
    );
  } else {
    // TODO: finish reserve init
    // @FIXME
    const MAX_UTILIZATION_RATE = 80;
    instructions.push(
      initReserveInstruction(
        amountLamports,
        MAX_UTILIZATION_RATE,
        sourceLiquidityAccount,
        destinationCollateralAccount,
        reserveAddress,
        reserve.liquidity.mint,
        reserve.liquidity.supply,
        reserve.collateral.mint,
        reserve.collateral.supply,
        reserve.lendingMarket,
        lendingMarketAuthority,
        transferAuthority.publicKey,
        reserve.aggregator,
      ),
    );
  }

  try {
    let { txid }  = await sendTransaction(
      connection,
      wallet,
      instructions.concat(cleanupInstructions),
      signers,
      true,
    );

    notify({
      message: 'Funds deposited.',
      type: 'success',
      description: `Transaction - ${txid}`,
    });
  } catch {
    // TODO:
    throw new Error();
  }
};
