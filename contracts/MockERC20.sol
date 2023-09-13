// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract MockERC20 is ERC20, ERC20Burnable {
    constructor(uint256 initialSupply) ERC20("MockERC20", "MOCK") {
        _mint(msg.sender, initialSupply);
    }
}
