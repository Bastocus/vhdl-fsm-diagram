-- Issue #1: AND/OR precedence in nested condition chains.
-- A nested `if` inside `if a or b then` must AND the inner condition with the
-- WHOLE outer condition, i.e. `(a or b) and c`, not the ambiguous
-- `a or b and c` (which reads as `a or (b and c)` under and>or precedence).
-- Negated `or` guards (elsif/else) are already wrapped by `not (...)` and must
-- not be double-wrapped; conditions the user already parenthesized must not be
-- double-wrapped either.
--
-- EXPECT idle -> s1 | (a or b) and c
-- EXPECT idle -> s2 | not (a or b) and (d or e) and f
-- EXPECT idle -> s3 | not (a or b) and not (d or e) and g
-- EXPECT s1 -> s4 | (h or i) and j
-- EXPECT s2 -> s4 | (always)
-- EXPECT s3 -> s4 | (always)
-- EXPECT s4 -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_or_and_precedence is
end fsm_or_and_precedence;

architecture rtl of fsm_or_and_precedence is
  type state_t is (idle, s1, s2, s3, s4);
  signal state : state_t;
  signal a, b, c, d, e, f, g, h, i, j : boolean;
begin
  process
  begin
    case state is
      when idle =>
        if a or b then
          if c then
            state <= s1;
          end if;
        elsif d or e then
          if f then
            state <= s2;
          end if;
        else
          if g then
            state <= s3;
          end if;
        end if;
      when s1 =>
        if (h or i) then
          if j then
            state <= s4;
          end if;
        end if;
      when s2 =>
        state <= s4;
      when s3 =>
        state <= s4;
      when s4 =>
        state <= idle;
    end case;
    wait;
  end process;
end rtl;
