pragma circom 2.0.0;

/*
 * age_range.circom — KYC age-range proof (#1300).
 *
 * Proves   minAge <= (currentYear - birthYear) <= maxAge
 * WITHOUT revealing `birthYear`.
 *
 *   private input : birthYear
 *   public inputs : currentYear, minAge, maxAge
 *
 * Range checks use Num2Bits: a negative difference wraps around the field to a
 * huge value that cannot be written in `n` bits, so the witness is rejected.
 * The circuit is self-contained (no circomlib dependency).
 */

// Constrains `out` to be the n-bit little-endian decomposition of `in`.
template Num2Bits(n) {
    signal input in;
    signal output out[n];
    var lc1 = 0;
    var e2 = 1;
    for (var i = 0; i < n; i++) {
        out[i] <-- (in >> i) & 1;
        out[i] * (out[i] - 1) === 0;
        lc1 += out[i] * e2;
        e2 = e2 + e2;
    }
    lc1 === in;
}

template AgeRange() {
    signal input birthYear;   // private
    signal input currentYear; // public
    signal input minAge;      // public
    signal input maxAge;      // public

    signal age;
    age <== currentYear - birthYear;

    // age - minAge >= 0  (fits in 8 bits => age, minAge, maxAge are < 256)
    component aboveMin = Num2Bits(8);
    aboveMin.in <== age - minAge;

    // maxAge - age >= 0
    component belowMax = Num2Bits(8);
    belowMax.in <== maxAge - age;
}

component main { public [currentYear, minAge, maxAge] } = AgeRange();
