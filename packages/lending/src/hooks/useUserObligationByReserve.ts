import { PublicKey } from '@solana/web3.js';
import { useMemo } from 'react';
import { useUserObligations } from './useUserObligations';

export function useUserObligationByReserve(
  borrowReserve?: string | PublicKey,
  depositReserve?: string | PublicKey,
) {
  const { userObligations } = useUserObligations();

  const userObligationsByReserve = useMemo(() => {
    const borrowId =
      typeof borrowReserve === 'string'
        ? borrowReserve
        : borrowReserve?.toBase58();
    const depositId =
      typeof depositReserve === 'string'
        ? depositReserve
        : depositReserve?.toBase58();
    return userObligations.filter(item =>
      borrowId && depositId
        ? item.obligation.info.borrows.borrowReserve.toBase58() === borrowId &&
          item.obligation.info.deposits.depositReserve.toBase58() === depositId
        : (borrowId &&
            item.obligation.info.borrows.borrowReserve.toBase58() ===
              borrowId) ||
          (depositId &&
            item.obligation.info.deposits.depositReserve.toBase58() ===
              depositId),
    );
  }, [borrowReserve, depositReserve, userObligations]);

  return {
    userObligationsByReserve,
  };
}
