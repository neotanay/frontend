import { memo, useEffect, useState } from 'react';
import { sortValues, valuesMatch } from '../../utils/numericOps';

function ValuesList({ values, checkedValues, onToggleValue, loading }) {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!loading) return undefined;
    setElapsedSec(0);
    const start = Date.now();
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [loading]);

  if (loading) {
    return <div className="fb-val-loading">Loading... ({elapsedSec}s)</div>;
  }
  if (!values.length) {
    return <div className="fb-val-empty">No values found</div>;
  }

  const checked = values.filter((v) => checkedValues.some((cv) => valuesMatch(cv, v)));
  const unchecked = values.filter((v) => !checkedValues.some((cv) => valuesMatch(cv, v)));
  const sorted = [...sortValues(checked), ...sortValues(unchecked)];

  return (
    <div className="fb-val-list">
      {sorted.map((v) => {
        const vStr = String(v);
        const id = `cchk_${vStr}`;
        return (
          <div key={vStr} className="fb-val-item">
            <input
              type="checkbox"
              id={id}
              checked={checkedValues.some((cv) => valuesMatch(cv, vStr))}
              onChange={() => onToggleValue(vStr)}
            />
            <label htmlFor={id}>{vStr}</label>
          </div>
        );
      })}
    </div>
  );
}

export default memo(ValuesList);
