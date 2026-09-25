import React from 'react';
import { receiverPhoneLines } from '../utils/format';

interface ReceiverPhonesProps {
  phone?: string | null;
  alternate?: string | null;
}

/** The receiver's phone with the alternate number (if any) on the line below. */
const ReceiverPhones: React.FC<ReceiverPhonesProps> = ({ phone, alternate }) => (
  <>
    {receiverPhoneLines(phone, alternate).map((line, i) => (
      <React.Fragment key={line}>
        {i > 0 && <br />}
        {line}
      </React.Fragment>
    ))}
  </>
);

export default ReceiverPhones;
