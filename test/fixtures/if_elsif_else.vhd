-- Phase 1: if/elsif/else with negation rendering.
-- Exercises the full condition path with explicit NOT for elsif/else.
--
-- EXPECT idle -> s1 | cond_a = '1'
-- EXPECT idle -> s2 | not (cond_a) and cond_b = '1'
-- EXPECT idle -> s3 | not (cond_a) and not (cond_b)
-- EXPECT s1 -> idle | (always)
-- EXPECT s2 -> idle | (always)
-- EXPECT s3 -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_if_elsif_else is
end fsm_if_elsif_else;

architecture rtl of fsm_if_elsif_else is
  type state_t is (idle, s1, s2, s3);
  signal state : state_t;
  signal cond_a, cond_b : std_logic;
begin
  process
  begin
    case state is
      when idle =>
        if cond_a = '1' then
          state <= s1;
        elsif cond_b = '1' then
          state <= s2;
        else
          state <= s3;
        end if;
      when s1 =>
        state <= idle;
      when s2 =>
        state <= idle;
      when s3 =>
        state <= idle;
    end case;
    wait;
  end process;
end rtl;
